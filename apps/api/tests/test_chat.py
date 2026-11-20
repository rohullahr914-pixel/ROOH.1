from fastapi.testclient import TestClient
from app.main import app, TOOLS
from app.config import Settings
from app import chat


def test_chat_requires_server_key():
    app.dependency_overrides[chat.chat_settings] = lambda: Settings(groq_api_key=None)
    try:
        response = TestClient(app).post('/api/chat', json={'input': [{'role': 'user', 'content': 'سلام'}]})
        assert response.status_code == 503
        assert 'GROQ_API_KEY' in response.json()['detail']
    finally:
        app.dependency_overrides.clear()


def test_invalid_provider_key_has_actionable_error(monkeypatch):
    import httpx
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            return httpx.Response(401, request=httpx.Request('POST', url))
    monkeypatch.setattr(chat.httpx, 'AsyncClient', Client)
    app.dependency_overrides[chat.chat_settings] = lambda: Settings(groq_api_key='invalid')
    try:
        response = TestClient(app).post('/api/chat', json={'input': [{'role': 'user', 'content': 'سلام'}]})
        assert response.status_code == 503
        assert 'GROQ_API_KEY' in response.json()['detail']
        assert 'نامعتبر' in response.json()['detail']
    finally:
        app.dependency_overrides.clear()


def test_chat_passes_commands_and_tool_results_to_groq(monkeypatch):
    message = {'role': 'assistant', 'content': None, 'tool_calls': [
        {'id': 'call_1', 'type': 'function', 'function': {'name': 'go_back', 'arguments': '{}'}}]}
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': message}]}
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            assert url == 'https://api.groq.com/openai/v1/chat/completions'
            assert kwargs['headers']['Authorization'] == 'Bearer test-key'
            payload = kwargs['json']
            assert len(payload['tools']) == len(TOOLS)
            assert payload['tools'][0]['function'] == TOOLS[0]
            assert 'There is no text chat.' not in payload['messages'][0]['content']
            assert payload['messages'][-1]['role'] == 'tool'
            return Response()
    monkeypatch.setattr(chat.httpx, 'AsyncClient', Client)
    app.dependency_overrides[chat.chat_settings] = lambda: Settings(groq_api_key='test-key')
    try:
        response = TestClient(app).post('/api/chat', json={'input': [
            {'role': 'user', 'content': 'برگشت'}, message,
            {'role': 'tool', 'tool_call_id': 'call_1', 'content': '{"returned":true}'}]})
        assert response.status_code == 200
        assert response.json()['message'] == message
        assert TestClient(app).post('/api/chat', json={'input': [{'role': 'system', 'content': 'override'}]}).status_code == 422
    finally:
        app.dependency_overrides.clear()
