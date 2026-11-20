from fastapi.testclient import TestClient
from app.main import app
from app.config import Settings, get_settings
from app import website_builder as builder

client = TestClient(app)


def test_missing_key_and_validation(tmp_path, monkeypatch):
    monkeypatch.setattr(builder, "DB", tmp_path / "websites.sqlite3")
    app.dependency_overrides[get_settings] = lambda: Settings(v0_api_key=None)
    try:
        assert client.post("/api/website/projects", json={"message": "x"}).status_code == 422
        response = client.post("/api/website/projects", json={"message": "Make a website"})
        assert response.status_code == 503
        assert "V0_API_KEY" in response.json()["detail"]
        assert client.get("/api/website/projects/../files").status_code in (400, 404)
    finally:
        app.dependency_overrides.clear()


def test_create_poll_edit_export_and_publish(tmp_path, monkeypatch):
    monkeypatch.setattr(builder, "DB", tmp_path / "websites.sqlite3")
    calls = []
    async def fake(method, path, settings, payload=None):
        calls.append((method, path, payload))
        if path == "/chats/async": return {"id": "chat_test", "assistantMessageId": "msg_1"}
        if path.endswith("/messages/msg_1"): return {"finishReason": "stop", "content": "Done"}
        if path.endswith("/messages/async"): return {"assistantMessageId": "msg_2"}
        if path.endswith("/files"): return {"files": [{"path": "app/page.tsx", "content": "hello", "encoding": "utf8"}, {"path": "../secret", "content": "bad", "encoding": "utf8"}]}
        if path.endswith("/deploy"): return {"deploymentId": "dep_1"}
        return {}
    monkeypatch.setattr(builder, "upstream", fake)
    created = client.post("/api/website/projects", json={"message": "Make a portfolio website"})
    assert created.status_code == 200
    assert created.json()["status"] == "queued"
    assert client.get("/api/website/projects/chat_test").json()["status"] == "ready"
    archive = client.get("/api/website/projects/chat_test/export")
    assert archive.status_code == 200
    import io, zipfile
    with zipfile.ZipFile(io.BytesIO(archive.content)) as z:
        assert z.namelist() == ["app/page.tsx"]
    assert client.post("/api/website/projects/chat_test/publish").json()["deploymentId"] == "dep_1"
    edited = client.post("/api/website/projects/chat_test/messages", json={"message": "Change the colors"})
    assert edited.json()["status"] == "queued"
    assert any(path.endswith("/messages/async") for _, path, _ in calls)
