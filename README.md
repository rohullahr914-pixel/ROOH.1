# RooH AI V1

RooH is a voice-first multimodal assistant with a persistent OpenAI Realtime conversation and adaptive YouTube, 3D, and Wikimedia workspaces.

Set `OPENAI_API_KEY=your_key_here` in the repository root `.env` and restart `npm run dev`. The key stays on the server and enables voice, camera analysis, and optional market commentary.
## Run locally

Requirements: Node 20+, Python 3.11+, a modern Chromium browser, and HTTPS or localhost for camera/microphone access.

1. Copy `apps/api/.env.example` to `apps/api/.env` and set server-side credentials. YouTube search requires a Google API key with YouTube Data API v3 enabled. Replace the sample Wikimedia contact in `WIKIPEDIA_USER_AGENT` with a real project URL or contact email. Create `apps/web/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:8000`.
- Wikipedia requires outbound access to Wikimedia and a descriptive `WIKIPEDIA_USER_AGENT`; networks blocked by Wikimedia's robot policy must be cleared with the network administrator or Wikimedia. Sketchfab assets may prohibit download or component editing; the built-in assembly guarantees editable components.
2. Install and start the backend:
   ```powershell
   cd apps/api
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```
3. In another terminal, install and start the frontend:
   ```powershell
   npm install
   npm run dev
   ```
4. Open `http://localhost:3000`. Grant microphone or camera access only when you choose to enable it.

## Architecture

## AI Website Builder

Paste your v0 Platform API key into the repository root `.env` as `V0_API_KEY=your_key_here`. The same name is documented in `.env.example`. Keep it out of `NEXT_PUBLIC_` variables. Restart `npm run dev` after changing the key, then open `http://localhost:3000` and choose **BUILD WEBSITE** in the top bar. You can also ask ROOH by voice to build a website or edit the selected website (voice requires the OpenAI setup).

Projects and prompts are indexed locally in `.rooh-private/websites.sqlite3`; source and generation remain with v0. The builder supports follow-up edits, project history, desktop/tablet/mobile previews, source browsing, ZIP export, and v0 deployment. Publishing requires v0/Vercel account permissions and returns a deployment ID. The v0 Platform API v2 is currently labeled beta by v0 and may change. Live generation, previews, and publishing require a valid v0 key; local tests use mocked v0 responses.


- `apps/web`: Next.js App Router UI, Web Audio voice transport, MediaPipe gestures, YouTube player, React Three Fiber assembly.
- `apps/api`: FastAPI typed REST integrations and a OpenAI Realtime WebSocket relay. Secrets never enter the browser.
- For a slow browser-to-API link, set `NEXT_PUBLIC_COMPRESSED_VOICE=true` in the web environment and restart Next.js. This uses G.711 μ-law between the browser and API (about half the raw PCM audio payload), while the API sends OpenAI its required PCM format. Both modes use the server relay. The default uses 24 kHz PCM throughout.
- OpenAI tool calls are dispatched by the browser to workspace controls and typed server endpoints, surfaced as workspace events, and acknowledged back to OpenAI only after execution.
- YouTube search uses `YOUTUBE_API_KEY` only on the API server, caches results briefly, and returns separate guidance for quota exhaustion, invalid credentials, and network failures.

## Supported gestures

Open palm reveals minimized panels and a horizontal swipe changes the selected YouTube result or spatial object. A fist returns to the neural workspace. Pinch selects or drags a panel/object; two hands scale and rotate the selected object. Use the calibration panel to tune smoothing. Keyboard, touch, and mouse controls remain available.

## Honest verification boundaries

Automated tests cover API validation, missing-key behavior, YouTube response parsing/cache/quota handling, state transitions, and UI utilities. Live OpenAI, YouTube, and Sketchfab calls require your credentials and quota and must be verified locally. Wikipedia requires network access. Sketchfab assets may prohibit download or component editing; the built-in assembly guarantees editable components.

## Adding a 3D asset

RooH resolves voice requests through `apps/web/src/lib/asset-registry.ts`. Add only assets that have a stable GLB/glTF URL and clear redistribution terms. Every registry entry requires an ID, name, category, multilingual aliases, source, attribution, license, and URL. Khronos sample assets are the built-in reliable fallback. Sketchfab results remain official embeds unless their license explicitly permits download; the application never scrapes or bypasses source restrictions.

The viewer supports automatic framing, mesh selection/highlighting, exploded view for multi-mesh assets, built-in animation playback, mouse/touch orbit controls, and MediaPipe hand translation, rotation, and scaling. Model component quality depends on the source file's mesh hierarchy and names.


## Downloaded 3D gallery

Open **مدل‌های سه‌بعدی** in the bottom controls, filter by category or search in Persian/English, then select a preview to display the model. Voice requests use the same asset registry and local files. Asking which models are available also opens the gallery.

The catalog selects 20 models; the gallery shows only completed local downloads. Models are self-contained GLB files with local preview images from the official Khronos glTF Sample Assets collection. Files are served from `apps/web/public/models/`; each asset has its upstream `SOURCE.md` notice and any additional logo notices. Full attribution, source links, file size, and animation availability are recorded in `apps/web/src/lib/downloaded-models.json` and shown in the gallery. Models retain their individual licenses; RooH has not modified their geometry or textures.

To restore missing gallery files, run `python scripts/download-models.py` from the repository root. The downloader checks GLB headers, embedded resources, mesh presence, and records SHA-256 hashes. Downloads use jsDelivr's mirror of the official repository. Gallery browsing and downloaded model loading require no Sketchfab token or external model request.

## Personal WhatsApp

ROOH includes an owner-authenticated WhatsApp QR panel, approved contacts, and expiring message confirmation. See [setup, security, and real-device verification](WHATSAPP.md). Start all three services with `npm run dev` after configuring the two WhatsApp secrets.
# Read-only Market Analyst

Install the API dependencies (`pip install -r apps/api/requirements.txt`) and web dependencies (`npm install`). In the repository root `.env`, set `TWELVEDATA_API_KEY` to your Twelve Data key. Keep it server-side; never use `NEXT_PUBLIC_` for it. Set `OPENAI_API_KEY` to enable optional AI commentary. Start ROOH normally, then open **MARKETS** or ask ROOH to open the trading analyst.

The panel supports XAUUSD, EURUSD, GBPUSD and six timeframes. It loads Twelve Data candles and refreshes once per minute to conserve free credits. It shows RSI, MACD, EMA 20, and 30-candle support and resistance. AI commentary is requested only after real candles load. XAU/USD access depends on the Twelve Data plan. No trade actions are implemented.
