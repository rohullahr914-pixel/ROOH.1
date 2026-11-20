"""Server-side v0 Platform API v2 integration and local project index."""
import io
import re
import sqlite3
import zipfile
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .config import Settings, get_settings

router = APIRouter(prefix="/api/website", tags=["website builder"])
BASE = "https://v0.app/api/v2"
DB = Path(__file__).resolve().parents[3] / ".rooh-private" / "websites.sqlite3"
ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


class Prompt(BaseModel):
    message: str = Field(min_length=3, max_length=8000)


def database():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.execute("CREATE TABLE IF NOT EXISTS websites (id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, message_id TEXT, deployment_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)")
    return con


def local(chat_id: str):
    if not ID.fullmatch(chat_id):
        raise HTTPException(400, "Invalid project ID")
    with database() as con:
        row = con.execute("SELECT * FROM websites WHERE id=?", (chat_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Website project not found")
    return dict(row)


async def upstream(method: str, path: str, s: Settings, payload=None):
    if not s.v0_api_key:
        raise HTTPException(503, "V0_API_KEY is not configured on the API server")
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.request(method, BASE + path, headers={"Authorization": f"Bearer {s.v0_api_key}", "Accept": "application/json"}, json=payload)
    except httpx.TimeoutException:
        raise HTTPException(504, "v0 timed out. Retry in a moment")
    except httpx.RequestError:
        raise HTTPException(502, "Could not reach v0")
    if response.status_code >= 400:
        try:
            detail = response.json().get("error", {}).get("message") or response.json().get("message")
        except (ValueError, AttributeError):
            detail = None
        raise HTTPException(response.status_code if response.status_code in (400, 401, 403, 404, 409, 413, 422, 429) else 502, detail or f"v0 returned {response.status_code}")
    result = response.json() if response.content else {}
    if isinstance(result, dict) and result.get("error"):
        error = result["error"]
        detail = error.get("message") if isinstance(error, dict) else str(error)
        raise HTTPException(502, detail or "v0 rejected the request")
    return result


@router.get("/projects")
def projects():
    with database() as con:
        return {"projects": [dict(row) for row in con.execute("SELECT * FROM websites ORDER BY updated_at DESC")]}


@router.post("/projects")
async def create(prompt: Prompt, s: Settings = Depends(get_settings)):
    result = await upstream("POST", "/chats/async", s, {"message": prompt.message, "privacy": "private", "title": prompt.message[:80], "metadata": {"source": "rooh-website-builder"}})
    chat_id = result.get("id") if isinstance(result, dict) else None
    if not isinstance(chat_id, str) or not ID.fullmatch(chat_id):
        raise HTTPException(502, "v0 returned an unexpected response. Check the v0 API key and account access.")
    with database() as con:
        con.execute("INSERT INTO websites (id,title,prompt,status,message_id) VALUES (?,?,?,?,?)", (chat_id, prompt.message[:80], prompt.message, "queued", result.get("assistantMessageId")))
    return local(chat_id)


@router.get("/projects/{chat_id}")
async def project(chat_id: str, s: Settings = Depends(get_settings)):
    row = local(chat_id)
    if row["status"] == "queued" and row["message_id"]:
        msg = await upstream("GET", f"/chats/{chat_id}/messages/{row['message_id']}", s)
        if msg.get("finishReason"):
            status = "ready" if msg["finishReason"] == "stop" else "error"
            with database() as con:
                con.execute("UPDATE websites SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (status, chat_id))
            row = local(chat_id)
            row["message"] = msg.get("content", "")
    return row


@router.post("/projects/{chat_id}/messages")
async def edit(chat_id: str, prompt: Prompt, s: Settings = Depends(get_settings)):
    row = local(chat_id)
    if row["status"] == "queued":
        raise HTTPException(409, "Wait for the current generation to finish")
    result = await upstream("POST", f"/chats/{chat_id}/messages/async", s, {"message": prompt.message})
    message_id = result.get("assistantMessageId") or result.get("id")
    if not message_id:
        raise HTTPException(502, "v0 did not return a message ID")
    with database() as con:
        con.execute("UPDATE websites SET status='queued', message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (message_id, chat_id))
    return local(chat_id)


@router.get("/projects/{chat_id}/messages")
async def messages(chat_id: str, s: Settings = Depends(get_settings)):
    local(chat_id)
    return await upstream("GET", f"/chats/{chat_id}/messages", s)


@router.get("/projects/{chat_id}/files")
async def files(chat_id: str, s: Settings = Depends(get_settings)):
    local(chat_id)
    return await upstream("GET", f"/chats/{chat_id}/files", s)


@router.get("/projects/{chat_id}/export")
async def export(chat_id: str, s: Settings = Depends(get_settings)):
    result = await files(chat_id, s)
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for file in result.get("files", []):
            name = file.get("path", "")
            if not name or name.startswith("/") or ".." in Path(name).parts or "\\" in name:
                continue
            if file.get("encoding") == "base64":
                import base64
                content = base64.b64decode(file["content"])
            else:
                content = file.get("content", "").encode()
            z.writestr(name, content)
    archive.seek(0)
    return StreamingResponse(archive, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="rooh-website-{chat_id}.zip"'})


@router.post("/projects/{chat_id}/publish")
async def publish(chat_id: str, s: Settings = Depends(get_settings)):
    row = local(chat_id)
    if row["status"] != "ready":
        raise HTTPException(409, "Finish generation before publishing")
    result = await upstream("POST", f"/chats/{chat_id}/deploy", s, {})
    with database() as con:
        con.execute("UPDATE websites SET deployment_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (result.get("deploymentId"), chat_id))
    return result


