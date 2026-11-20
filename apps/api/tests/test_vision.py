import base64
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
from app.main import app
from app.config import Settings, get_settings
from app import vision

client = TestClient(app)

def test_vision_requires_configuration():
    app.dependency_overrides[get_settings] = lambda: Settings(openai_api_key=None)
    try:
        assert client.post('/api/vision/analyze', json={'image':'a'*20,'question':'What is this?'}).status_code == 503
    finally:
        app.dependency_overrides.clear()

def test_vision_validates_and_calls_multimodal_model(monkeypatch):
    generate = AsyncMock(return_value='This appears to be a component.')
    monkeypatch.setattr(vision, 'complete', generate)
    app.dependency_overrides[get_settings] = lambda: Settings(openai_api_key='test')
    try:
        assert client.post('/api/vision/analyze',json={'image':'invalid!'*3,'question':'What?'}).status_code == 422
        image = base64.b64encode(b'\xff\xd8\xff'+b'0'*20).decode()
        response=client.post('/api/vision/analyze',json={'image':image,'question':'What is this?'})
        assert response.status_code == 200
        assert response.json()['exact_identity_verified'] is False
        assert generate.call_count == 1
        assert generate.call_args.args[1][1]['content'][1]['image_url']['url'] == 'data:image/jpeg;base64,' + image
    finally:
        app.dependency_overrides.clear()
