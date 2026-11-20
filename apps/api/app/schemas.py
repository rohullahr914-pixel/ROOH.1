from typing import Literal
from pydantic import BaseModel, Field

class YouTubeResult(BaseModel):
    id: str
    title: str
    channel: str
    thumbnail: str

class YouTubeSearchResponse(BaseModel):
    items: list[YouTubeResult]

class ModelResult(BaseModel):
    uid: str
    name: str
    author: str
    thumbnail: str | None = None
    viewer_url: str | None = None
    license: str | None = None
    source: str = "sketchfab"
    asset_url: str | None = None

class ModelSearchResponse(BaseModel):
    items: list[ModelResult]

class KnowledgeImage(BaseModel):
    url: str
    width: int | None = None
    height: int | None = None

class KnowledgeProfile(BaseModel):
    title: str
    description: str | None = None
    extract: str
    page_url: str
    image: KnowledgeImage | None = None
    language: str

class ToolResult(BaseModel):
    call_id: str
    name: str
    ok: bool
    result: dict = Field(default_factory=dict)
    error: str | None = None

Workspace = Literal["home", "youtube", "models", "knowledge"]
