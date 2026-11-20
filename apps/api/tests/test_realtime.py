import asyncio
import base64
import json
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from app import main
from app.audio_codec import compress_pcm, expand_pcm
from app.config import Settings


@pytest.mark.parametrize("compressed", [False, True])
def test_realtime_relay(monkeypatch, compressed):
    pcm = b"\0\0" * 2880
    browser_audio = compress_pcm(pcm) if compressed else pcm
    upstream_audio = expand_pcm(browser_audio) if compressed else pcm
    events = []

    class Upstream:
        def __init__(self):
            self.output = asyncio.Queue()

        def __aiter__(self):
            return self

        async def __anext__(self):
            event = await self.output.get()
            if event is None:
                raise StopAsyncIteration
            return json.dumps(event)

        async def send(self, message):
            event = json.loads(message)
            events.append(event)
            if event["type"] == "session.update":
                await self.output.put({"type": "session.updated"})
            if event["type"] == "response.create":
                await self.output.put({"type": "response.output_audio.delta", "delta": base64.b64encode(pcm).decode()})
                await self.output.put(None)

    @asynccontextmanager
    async def connect(url, *, additional_headers):
        assert url == "wss://api.openai.com/v1/realtime?model=gpt-realtime"
        assert additional_headers == {"Authorization": "Bearer test-key"}
        yield Upstream()

    monkeypatch.setattr(main, "connect", connect)
    monkeypatch.setattr(main, "get_settings", lambda: Settings(openai_api_key="test-key"))
    with TestClient(main.app).websocket_connect(
        f"/ws/live?compressed={str(compressed).lower()}", headers={"origin": "http://localhost:3000"}
    ) as ws:
        assert ws.receive_json() == {"type": "session.updated"}
        ws.send_json({"type": "input_audio_buffer.append", "audio": base64.b64encode(browser_audio).decode()})
        ws.send_json({"type": "input_audio_buffer.commit"})
        assert base64.b64decode(ws.receive_json()["delta"]) == browser_audio
        assert ws.receive()["type"] == "websocket.close"

    assert events[0]["session"]["audio"]["input"]["format"]["rate"] == 24000
    assert all(tool["type"] == "function" for tool in events[0]["session"]["tools"])
    assert base64.b64decode(events[1]["audio"]) == upstream_audio
    assert [event["type"] for event in events[2:]] == ["input_audio_buffer.commit", "response.create"]
