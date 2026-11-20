import httpx

from .config import Settings


async def complete(settings: Settings, messages: list[dict], *, max_tokens: int = 700) -> str:
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            json={"model": settings.openai_text_model, "messages": messages,
                  "max_completion_tokens": max_tokens, "store": False},
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"].get("content") or ""
