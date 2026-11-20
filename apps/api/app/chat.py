import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .config import Settings

router = APIRouter()


def chat_settings() -> Settings:
    # Re-read .env so adding or replacing a chat key takes effect immediately.
    return Settings()


class ChatRequest(BaseModel):
    input: list[dict] = Field(min_length=1, max_length=160)


@router.post("/api/chat")
async def chat(body: ChatRequest, settings: Settings = Depends(chat_settings)):
    # Import at request time to share the voice command registry without a cycle.
    from .main import TOOLS, SYSTEM_INSTRUCTION

    if not settings.groq_api_key:
        raise HTTPException(503, "برای چت، GROQ_API_KEY را در فایل .env تنظیم و سرور را دوباره اجرا کنید.")
    if len(json.dumps(body.input)) > 250_000:
        raise HTTPException(413, "گفتگو طولانی است؛ گفتگوی تازه‌ای شروع کنید.")
    for item in body.input:
        if item.get("role") in ("system", "developer"):
            raise HTTPException(422, "Unsupported message role")
    instructions = SYSTEM_INSTRUCTION.replace("voice-only", "text-based").replace("There is no text chat.", "This is a text chat powered by Groq.")
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                json={"model": settings.groq_model, "messages": [{"role": "system", "content": instructions}, *body.input],
                      "parallel_tool_calls": False,
                      "tools": [{"type": "function", "function": tool} for tool in TOOLS]},
            )
            response.raise_for_status()
            message = response.json()["choices"][0]["message"]
            return {"message": {key: message[key] for key in ("role", "content", "tool_calls") if key in message}}
    except httpx.TimeoutException:
        raise HTTPException(504, "پاسخ Groq طول کشید؛ دوباره تلاش کنید.")
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        if status == 401:
            raise HTTPException(503, "Groq کلید را نامعتبر اعلام کرد. مقدار GROQ_API_KEY را با کلید معتبر حساب Groq جایگزین کنید.")
        if status == 429:
            raise HTTPException(429, "محدودیت درخواست یا اعتبار Groq تمام شده است؛ کمی بعد تلاش کنید یا حساب Groq را بررسی کنید.")
        if status in (400, 404):
            raise HTTPException(502, "Groq درخواست یا مدل را نپذیرفت؛ مقدار GROQ_MODEL و دسترسی حساب به مدل را بررسی کنید.")
        raise HTTPException(502, "سرویس Groq موقتاً در دسترس نیست؛ دوباره تلاش کنید.")
    except httpx.RequestError:
        raise HTTPException(502, "ارتباط شبکه با Groq قطع شد؛ اتصال اینترنت یا پراکسی سرور را بررسی و دوباره تلاش کنید.")
    except (KeyError, IndexError, TypeError, ValueError):
        raise HTTPException(502, "پاسخ Groq قابل خواندن نبود؛ دوباره تلاش کنید.")
