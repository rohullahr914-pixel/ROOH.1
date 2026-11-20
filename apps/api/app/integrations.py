import asyncio
import html
import re
import time
from urllib.parse import quote
import httpx
from fastapi import HTTPException
from .config import Settings
from .schemas import *

TIMEOUT = httpx.Timeout(12.0)
YOUTUBE_CACHE_TTL = 60.0
INTEGRATION_CACHE_TTL = 900.0
STALE_CACHE_TTL = 86400.0
RETRY_DELAYS = (0.25, 0.6)
_youtube_cache: dict[str, tuple[float, YouTubeSearchResponse]] = {}
_youtube_cache_lock = asyncio.Lock()
_model_cache: dict[str, tuple[float, ModelSearchResponse]] = {}
_profile_cache: dict[str, tuple[float, KnowledgeProfile]] = {}
_integration_cache_lock = asyncio.Lock()

_FALLBACK_MODELS = [
    {"uid": "damaged-helmet", "name": "Damaged Helmet", "author": "Khronos glTF Sample Assets / Leonardo Carrion", "license": "CC BY 4.0", "asset_url": "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb", "keywords": {"helmet", "astronaut", "space", "engineering", "کلاه", "فضا"}},
    {"uid": "car-concept", "name": "Concept Car", "author": "Khronos glTF Sample Assets / Unity Fan", "license": "CC BY 4.0", "asset_url": "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb", "keywords": {"car", "vehicle", "automobile", "concept", "موتر", "ماشین", "خودرو", "اتومبیل"}},
    {"uid": "cesium-milk-truck", "name": "Cesium Milk Truck", "author": "Khronos glTF Sample Assets / Cesium", "license": "CC BY 3.0", "asset_url": "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb", "keywords": {"truck", "milk", "کامیون", "باربری"}},
    {"uid": "avocado", "name": "Avocado", "author": "Khronos glTF Sample Assets", "license": "CC0", "asset_url": "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Avocado/glTF-Binary/Avocado.glb", "keywords": {"avocado", "fruit", "food", "آووکادو", "میوه"}},
    {"uid": "duck", "name": "Duck", "author": "Khronos glTF Sample Assets / Sony", "license": "SCEA Shared Source", "asset_url": "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb", "keywords": {"duck", "bird", "animal", "اردک", "پرنده"}},
]


async def _get_with_retry(client: httpx.AsyncClient, url: str, *, params: dict | None = None) -> httpx.Response:
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            response = await client.get(url, params=params)
        except httpx.TransportError:
            if attempt == len(RETRY_DELAYS):
                raise
            await asyncio.sleep(RETRY_DELAYS[attempt])
            continue
        if response.status_code not in {202, 429, 500, 502, 503, 504} or attempt == len(RETRY_DELAYS):
            return response
        await asyncio.sleep(RETRY_DELAYS[attempt])
    raise RuntimeError("Unreachable retry state")


def _fallback_models(query: str) -> ModelSearchResponse:
    words = set(re.findall(r"[\w\u0600-\u06ff]+", query.casefold()))
    matches = [model for model in _FALLBACK_MODELS if words & model["keywords"]]
    return ModelSearchResponse(items=[
        ModelResult(
            uid=model["uid"], name=model["name"], author=model["author"],
            viewer_url=None, license=model["license"], source="khronos",
            asset_url=model["asset_url"],
        )
        for model in matches
    ])

async def search_youtube(query: str, settings: Settings) -> YouTubeSearchResponse:
    if not settings.youtube_api_key:
        raise HTTPException(503, "YouTube search is not configured. Set YOUTUBE_API_KEY on the server.")
    query = " ".join(query.split())
    if not query:
        raise HTTPException(422, "Search query cannot be blank.")
    cache_key = query.casefold()
    async with _youtube_cache_lock:
        cached = _youtube_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < YOUTUBE_CACHE_TTL:
            return cached[1]
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            for attempt in range(2):
                r = await client.get("https://www.googleapis.com/youtube/v3/search", params={
                    "part": "snippet", "type": "video", "maxResults": 8, "q": query,
                    "key": settings.youtube_api_key, "safeSearch": "moderate"
                })
                if r.status_code not in (429, 500, 502, 503, 504) or attempt:
                    break
                await asyncio.sleep(.2)
    except httpx.TimeoutException as exc:
        raise HTTPException(503, "YouTube search timed out. Try again shortly.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(503, "YouTube could not be reached from this network.") from exc
    if r.status_code == 403:
        try:
            reasons = {x.get("reason") for x in r.json().get("error", {}).get("errors", [])}
        except (ValueError, AttributeError):
            reasons = set()
        if reasons & {"quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"}:
            raise HTTPException(429, "YouTube search quota is exhausted. Try again after the quota resets.")
        if reasons & {"keyInvalid", "accessNotConfigured"}:
            raise HTTPException(503, "YouTube API credentials are invalid or the YouTube Data API v3 is not enabled.")
        raise HTTPException(403, "YouTube denied this request. Verify API key restrictions and YouTube Data API v3 access.")
    if r.status_code == 400:
        try:
            message = str(r.json().get("error", {}).get("message", ""))
        except (ValueError, AttributeError):
            message = ""
        if "api key not valid" in message.casefold():
            raise HTTPException(503, "YouTube API credentials are invalid. Create a current Google API key with YouTube Data API v3 enabled, then update YOUTUBE_API_KEY.")
    if r.status_code == 429:
        raise HTTPException(429, "YouTube is rate-limiting search requests. Wait briefly and try again.")
    if r.status_code >= 400:
        try:
            error = r.json().get("error", {})
            reason = next((x.get("reason") for x in error.get("errors", []) if x.get("reason")), None)
        except (ValueError, AttributeError):
            reason = None
        suffix = f" ({reason})" if reason else ""
        raise HTTPException(502, f"YouTube rejected the search request{suffix}. Verify the key, API enablement, restrictions, and quota.")
    try:
        items = []
        for item in r.json().get("items", []):
            video_id = item.get("id", {}).get("videoId")
            snippet = item.get("snippet", {})
            thumbnails = snippet.get("thumbnails", {})
            thumbnail = next((thumbnails[key]["url"] for key in ("high", "medium", "default") if thumbnails.get(key, {}).get("url")), None)
            if video_id and snippet.get("title") and thumbnail:
                items.append(YouTubeResult(id=video_id, title=snippet["title"], channel=snippet.get("channelTitle", "Unknown channel"), thumbnail=thumbnail))
        response = YouTubeSearchResponse(items=items)
    except (ValueError, AttributeError, KeyError, TypeError) as exc:
        raise HTTPException(502, "YouTube returned a response RooH could not read.") from exc
    async with _youtube_cache_lock:
        _youtube_cache[cache_key] = (time.monotonic(), response)
        if len(_youtube_cache) > 256:
            oldest = min(_youtube_cache, key=lambda key: _youtube_cache[key][0])
            _youtube_cache.pop(oldest, None)
    return response

async def search_models(query: str, settings: Settings) -> ModelSearchResponse:
    query = " ".join(query.split())
    if not query:
        raise HTTPException(422, "Search query cannot be blank.")
    cache_key = query.casefold()
    now = time.monotonic()
    async with _integration_cache_lock:
        cached = _model_cache.get(cache_key)
        if cached and now - cached[0] < INTEGRATION_CACHE_TTL:
            return cached[1]

    if settings.sketchfab_api_token:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, headers={"Authorization": f"Token {settings.sketchfab_api_token}"}) as client:
                response = await _get_with_retry(client, "https://api.sketchfab.com/v3/search", params={
                    "type": "models", "q": query, "count": 8, "sort_by": "-likeCount",
                })
            if response.status_code in (401, 403):
                raise HTTPException(503, "Sketchfab credentials were rejected; returning matching registry models where available.")
            if response.status_code == 202:
                raise HTTPException(503, "Sketchfab search remained pending after retries.")
            if response.status_code >= 400:
                raise HTTPException(502, f"Sketchfab search failed with HTTP {response.status_code}.")
            if not response.content or "json" not in response.headers.get("content-type", "").lower():
                raise HTTPException(502, "Sketchfab returned an empty or non-JSON response.")
            items = []
            for item in response.json().get("results", []):
                images = item.get("thumbnails", {}).get("images", [])
                thumbnail = images[-1].get("url") if images else None
                license_data = item.get("license") or {}
                items.append(ModelResult(
                    uid=item["uid"], name=item["name"],
                    author=(item.get("user") or {}).get("displayName", "Unknown"),
                    thumbnail=thumbnail,
                    viewer_url=f"https://sketchfab.com/models/{item['uid']}/embed",
                    license=license_data.get("label"), source="sketchfab",
                ))
            result = ModelSearchResponse(items=items)
            async with _integration_cache_lock:
                _model_cache[cache_key] = (time.monotonic(), result)
            return result
        except HTTPException:
            pass
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            pass

    async with _integration_cache_lock:
        cached = _model_cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < STALE_CACHE_TTL:
        return cached[1]
    fallback = _fallback_models(query)
    async with _integration_cache_lock:
        _model_cache[cache_key] = (time.monotonic(), fallback)
    return fallback

def _plain_wikimedia_excerpt(value: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", "", value)).split())


async def _action_api_profile(client: httpx.AsyncClient, query: str, language: str) -> KnowledgeProfile | None:
    response = await _get_with_retry(
        client,
        f"https://{language}.wikipedia.org/w/api.php",
        params={
            "action": "query", "generator": "search", "gsrsearch": query,
            "gsrlimit": 1, "prop": "extracts|pageimages|description",
            "exintro": 1, "explaintext": 1, "piprop": "thumbnail",
            "pithumbsize": 800, "redirects": 1, "format": "json",
        },
    )
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        raise httpx.HTTPError(f"Wikipedia Action API returned HTTP {response.status_code}")
    pages = response.json().get("query", {}).get("pages", [])
    if isinstance(pages, dict):
        pages = list(pages.values())
    if not pages:
        return None
    page = pages[0]
    title = page.get("title")
    extract = _plain_wikimedia_excerpt(page.get("extract") or page.get("snippet") or "")
    if not title or not extract:
        return None
    thumbnail = page.get("thumbnail") or {}
    image = KnowledgeImage(url=thumbnail["source"], width=thumbnail.get("width"), height=thumbnail.get("height")) if thumbnail.get("source") else None
    return KnowledgeProfile(
        title=title, description=page.get("description"), extract=extract,
        page_url=f"https://{language}.wikipedia.org/wiki/{quote(title.replace(' ', '_'), safe='')}",
        image=image, language=language,
    )


async def knowledge_profile(query: str, language: str = "en", settings: Settings | None = None) -> KnowledgeProfile:
    query = " ".join(query.split())
    if not query:
        raise HTTPException(422, "Search query cannot be blank.")
    lang = language if language in {"en", "fa"} else "en"
    user_agent = (settings or Settings()).wikipedia_user_agent
    cache_key = f"{lang}:{query.casefold()}"
    now = time.monotonic()
    async with _integration_cache_lock:
        cached = _profile_cache.get(cache_key)
        if cached and now - cached[0] < INTEGRATION_CACHE_TTL:
            return cached[1]

    profile = None
    upstream_failure = False
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": user_agent, "Api-User-Agent": user_agent}) as client:
            try:
                search = await _get_with_retry(client, f"https://api.wikimedia.org/core/v1/wikipedia/{lang}/search/page", params={"q": query, "limit": 1})
                if search.status_code < 400:
                    hits = search.json().get("pages", [])
                    if hits:
                        hit = hits[0]
                        title = hit["title"]
                        summary = await _get_with_retry(client, f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{quote(title, safe='')}")
                        if summary.status_code < 400:
                            data = summary.json()
                            image = data.get("originalimage") or data.get("thumbnail")
                            knowledge_image = KnowledgeImage(url=image["source"], width=image.get("width"), height=image.get("height")) if image and image.get("source") else None
                            profile = KnowledgeProfile(
                                title=data.get("title", title), description=data.get("description"),
                                extract=data.get("extract", ""),
                                page_url=data.get("content_urls", {}).get("desktop", {}).get("page", f"https://{lang}.wikipedia.org/wiki/{quote(title)}"),
                                image=knowledge_image, language=lang,
                            )
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                upstream_failure = True

            if profile is None:
                try:
                    profile = await _action_api_profile(client, query, lang)
                except (httpx.HTTPError, ValueError, KeyError, TypeError):
                    upstream_failure = True
                    profile = None
    except httpx.HTTPError as exc:
        async with _integration_cache_lock:
            cached = _profile_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < STALE_CACHE_TTL:
            return cached[1]
        raise HTTPException(503, "Wikipedia and its fallback API could not be reached from this network.") from exc

    if profile is None:
        async with _integration_cache_lock:
            cached = _profile_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < STALE_CACHE_TTL:
            return cached[1]
        if upstream_failure:
            raise HTTPException(503, "Wikipedia and its fallback API could not return a profile from this network.")
        raise HTTPException(404, "No matching Wikipedia article was found.")
    async with _integration_cache_lock:
        _profile_cache[cache_key] = (time.monotonic(), profile)
    return profile
