import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.main import app
from app import integrations
from app.config import Settings, get_settings

client = TestClient(app)

def test_health_has_integrations():
    data = client.get("/health").json()
    assert data["status"] == "ok"
    assert "openai" in data["integrations"]

def test_query_validation():
    assert client.get("/api/youtube/search?q=").status_code == 422

def test_missing_youtube_key_is_clear():
    app.dependency_overrides[get_settings] = lambda: Settings(youtube_api_key=None)
    try:
        response = client.get("/api/youtube/search?q=music")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 503
    assert "YOUTUBE_API_KEY" in response.json()["detail"]

def test_youtube_search_parses_and_caches_official_results(monkeypatch):
    integrations._youtube_cache.clear()
    calls = []

    class FakeClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def get(self, url, params):
            calls.append(params)
            return SimpleNamespace(status_code=200, json=lambda: {"items": [{
                "id": {"videoId": "real-id"},
                "snippet": {"title": "Actual result", "channelTitle": "Channel", "thumbnails": {"medium": {"url": "https://img.example/video.jpg"}}},
            }]})

    monkeypatch.setattr(integrations.httpx, "AsyncClient", FakeClient)
    settings = Settings(youtube_api_key="test-key")
    first = asyncio.run(integrations.search_youtube("  neural   networks ", settings))
    second = asyncio.run(integrations.search_youtube("neural networks", settings))

    assert first.items[0].id == "real-id"
    assert first.items[0].thumbnail == "https://img.example/video.jpg"
    assert second == first
    assert len(calls) == 1
    integrations._youtube_cache.clear()

def test_youtube_quota_exhaustion_is_actionable(monkeypatch):
    class FakeClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def get(self, url, params):
            return SimpleNamespace(status_code=403, json=lambda: {"error": {"errors": [{"reason": "quotaExceeded"}]}})

    monkeypatch.setattr(integrations.httpx, "AsyncClient", FakeClient)
    integrations._youtube_cache.clear()
    with pytest.raises(HTTPException) as error:
        asyncio.run(integrations.search_youtube("quota test", Settings(youtube_api_key="test-key")))
    assert error.value.status_code == 429
    assert "quota" in error.value.detail.lower()

def test_invalid_youtube_key_is_actionable(monkeypatch):
    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, params):
            return SimpleNamespace(status_code=400, json=lambda: {"error": {"message": "API key not valid. Please pass a valid API key.", "errors": [{"reason": "badRequest"}]}})

    monkeypatch.setattr(integrations.httpx, "AsyncClient", FakeClient)
    integrations._youtube_cache.clear()
    with pytest.raises(HTTPException) as error:
        asyncio.run(integrations.search_youtube("test", Settings(youtube_api_key="expired-key")))
    assert error.value.status_code == 503
    assert "credentials are invalid" in error.value.detail.lower()

def test_wikipedia_profile_maps_image_source(monkeypatch):
    integrations._profile_cache.clear()
    responses = [
        SimpleNamespace(status_code=200, raise_for_status=lambda: None, json=lambda: {"pages": [{"title": "Alan Turing", "key": "Alan_Turing"}]}),
        SimpleNamespace(status_code=200, json=lambda: {
            "title": "Alan Turing",
            "description": "English computer scientist",
            "extract": "A mathematician and computer scientist.",
            "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Alan_Turing"}},
            "originalimage": {"source": "https://upload.wikimedia.org/alan.jpg", "width": 750, "height": 1002},
        }, raise_for_status=lambda: None),
    ]

    class FakeClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def get(self, url, params=None):
            return responses.pop(0)

    monkeypatch.setattr(integrations.httpx, "AsyncClient", FakeClient)
    profile = asyncio.run(integrations.knowledge_profile("Alan Turing"))

    assert profile.image.url == "https://upload.wikimedia.org/alan.jpg"
    assert profile.image.width == 750
    assert profile.page_url == "https://en.wikipedia.org/wiki/Alan_Turing"

def test_wikipedia_robot_policy_error_is_actionable(monkeypatch):
    integrations._profile_cache.clear()
    class FakeClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def get(self, url, params=None):
            return SimpleNamespace(status_code=403)

    monkeypatch.setattr(integrations.httpx, "AsyncClient", FakeClient)
    with pytest.raises(HTTPException) as error:
        asyncio.run(integrations.knowledge_profile("Alan Turing"))

    assert error.value.status_code == 503
    assert "fallback api" in error.value.detail.lower()

def test_wikimedia_search_falls_back_when_summary_is_blocked(monkeypatch):
    integrations._profile_cache.clear()
    responses = [
        SimpleNamespace(status_code=200, raise_for_status=lambda: None, json=lambda: {"pages": [{
            "title": "هوش مصنوعی", "key": "هوش_مصنوعی", "description": "شاخه‌ای از علوم رایانه",
            "excerpt": '<span class="searchmatch">هوش</span> مصنوعی',
            "thumbnail": {"url": "//upload.wikimedia.org/image.jpg", "width": 60, "height": 80},
        }]}),
        SimpleNamespace(status_code=403),
        SimpleNamespace(status_code=200, json=lambda: {"query": {"pages": [{
            "title": "هوش مصنوعی", "description": "شاخه‌ای از علوم رایانه",
            "extract": "هوش مصنوعی شاخه‌ای از علوم رایانه است.",
            "thumbnail": {"source": "https://upload.wikimedia.org/image.jpg", "width": 400, "height": 300},
        }]}}),
    ]

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, params=None): return responses.pop(0)

    monkeypatch.setattr(integrations.httpx, "AsyncClient", FakeClient)
    profile = asyncio.run(integrations.knowledge_profile("هوش مصنوعی", "fa"))
    assert "شاخه‌ای" in profile.extract
    assert profile.image.url == "https://upload.wikimedia.org/image.jpg"
    assert profile.language == "fa"


def test_sketchfab_retries_transient_response_and_caches(monkeypatch):
    integrations._model_cache.clear()
    responses = [
        SimpleNamespace(status_code=202),
        SimpleNamespace(
            status_code=200, content=b"{}", headers={"content-type": "application/json"},
            json=lambda: {"results": [{
                "uid": "model-id", "name": "A real model", "user": {"displayName": "Artist"},
                "thumbnails": {"images": [{"url": "https://img.example/model.jpg"}]},
                "license": {"label": "CC-BY"},
            }]},
        ),
    ]
    calls = []

    class FakeClient:
        def __init__(self, **kwargs):
            assert kwargs["headers"]["Authorization"] == "Token test-token"
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, params=None):
            calls.append(params)
            return responses.pop(0)

    monkeypatch.setattr(integrations.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(integrations, "RETRY_DELAYS", (0, 0))
    settings = Settings(sketchfab_api_token="test-token")
    first = asyncio.run(integrations.search_models("  test model ", settings))
    second = asyncio.run(integrations.search_models("test model", settings))

    assert first.items[0].uid == "model-id"
    assert first.items[0].source == "sketchfab"
    assert second == first
    assert len(calls) == 2
    integrations._model_cache.clear()


def test_sketchfab_outage_returns_displayable_registry_model():
    result = asyncio.run(integrations.search_models("astronaut helmet", Settings()))

    assert result.items[0].source == "khronos"
    assert result.items[0].asset_url.endswith("DamagedHelmet.glb")
    assert result.items[0].license == "CC BY 4.0"


def test_knowledge_endpoint_defaults_to_persian(monkeypatch):
    async def fake_profile(query, language, settings):
        return integrations.KnowledgeProfile(
            title="ایلان ماسک", extract="زندگی‌نامه فارسی", page_url="https://fa.wikipedia.org/wiki/Elon_Musk", language=language,
        )

    monkeypatch.setattr("app.main.knowledge_profile", fake_profile)
    response = client.get("/api/knowledge/profile?q=Elon%20Musk")

    assert response.status_code == 200
    assert response.json()["language"] == "fa"
    assert response.json()["extract"] == "زندگی‌نامه فارسی"


def test_model_endpoint_returns_searchable_glb_fallback(monkeypatch):
    async def fake_models(query, settings):
        return integrations.ModelSearchResponse(items=[integrations.ModelResult(
            uid="duck", name="Duck", author="Khronos", source="khronos",
            asset_url="https://models.example/Duck.glb", license="CC0",
        )])

    monkeypatch.setattr("app.main.search_models", fake_models)
    response = client.get("/api/models/search?q=duck")

    assert response.status_code == 200
    assert response.json()["items"][0]["asset_url"].endswith("Duck.glb")
    assert response.json()["items"][0]["source"] == "khronos"
