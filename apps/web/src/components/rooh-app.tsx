"use client";
import dynamic from "next/dynamic";
import { AlertTriangle, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRooH } from "@/lib/store";
import { SpatialPanel } from "./spatial-panel";
import { SpatialContent } from "./spatial-content";
import { GestureControl } from "./gesture-control";
import { WhatsAppPanel } from "./whatsapp-panel";
import { WebsiteBuilder } from "./website-builder";
import { VoiceControls } from "./voice-controls";
import { TextChat } from "./text-chat";
import { executeTool } from "@/lib/tool-executor";
import { setBrowserFullscreen } from "@/lib/browser-controls";
import { requestAudioMedia, requestVideoMedia } from "@/lib/media-session";

const CoreScene = dynamic(
  () => import("./core-scene").then((module) => module.CoreScene),
  { ssr: false },
);
type EntryState =
  "dormant" | "permission" | "awakening" | "returning" | "active";
const voiceLabels = {
  idle: "AI STANDBY",
  connecting: "AI CONNECTING",
  listening: "AI LISTENING",
  processing: "AI THINKING",
  speaking: "AI SPEAKING",
  interrupted: "AI INTERRUPTED",
  reconnecting: "AI RECONNECTING",
  disconnected: "AI OFFLINE",
  error: "AI ATTENTION",
};

export function RooHApp() {
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenPending, setFullscreenPending] = useState(false);
  useEffect(() => {
    const changed = () => {setFullscreen(Boolean(document.fullscreenElement));setFullscreenPending(false)};
    const pending = () => setFullscreenPending(true);
    document.addEventListener("fullscreenchange", changed);
    window.addEventListener("rooh:fullscreen-pending", pending);
    return () => {document.removeEventListener("fullscreenchange", changed);window.removeEventListener("rooh:fullscreen-pending", pending)};
  }, []);
  const [entry, setEntry] = useState<EntryState>("dormant"),
    [voiceEnabled, setVoiceEnabled] = useState(false),
    [handEnabled, setHandEnabled] = useState(false),
    [permissionBusy, setPermissionBusy] = useState(false);
  const {
      voice,
      camera,
      error,
      panels,
      objects,
      externalModel,
      selectedId,
      quality,
      set,
    } = useRooH(),
    selected = objects.find((object) => object.id === selectedId);
  useEffect(() => {
    const low =
      (navigator.hardwareConcurrency || 8) <= 4 ||
      matchMedia("(max-width: 720px)").matches;
    set({ quality: low ? "low" : "balanced" });
    // Camera and microphone permissions must be requested from a fresh user
    // gesture. Show the activation gateway on every visit instead of silently
    // entering with voice and hand control disabled for returning users.
    setEntry("permission");
  }, [set]);
  async function initialize() {
    setPermissionBusy(true);
    set({ error: undefined });
    if (!navigator.mediaDevices?.getUserMedia) {
      set({
        error:
          "Camera and microphone require localhost or a secure HTTPS connection.",
      });
      setPermissionBusy(false);
      return;
    }
    let microphone = false,
      cameraPermission = false;
    // Keep the first approved device streams alive. Closing the permission
    // probe and immediately opening the camera again is unreliable with some
    // Windows webcams and virtual-camera drivers.
    const [audioResult, videoResult] = await Promise.allSettled([
      requestAudioMedia(),
      requestVideoMedia(),
    ]);
    microphone =
      audioResult.status === "fulfilled" &&
      audioResult.value.getAudioTracks().some((track) => track.readyState === "live");
    cameraPermission =
      videoResult.status === "fulfilled" &&
      videoResult.value.getVideoTracks().some((track) => track.readyState === "live");
    localStorage.setItem("rooh:onboarded", "1");
    setEntry("awakening");
    setVoiceEnabled(microphone);
    setHandEnabled(cameraPermission);
    setPermissionBusy(false);
    if (!microphone || !cameraPermission) {
      set({
        error:
          microphone || cameraPermission
            ? `Access is incomplete: ${!microphone ? "microphone" : "camera"} permission was not granted.`
            : "Camera and microphone permissions were not granted. Allow both in your browser settings and try again.",
      });
    }
    setTimeout(() => setEntry("active"), 3200);
  }
  function limited() {
    localStorage.setItem("rooh:onboarded", "1");
    setEntry("awakening");
    setTimeout(() => setEntry("active"), 2600);
  }
  const gated = entry === "permission" || entry === "dormant";
  return (
    <main className={`rooh-shell entry-${entry}`}>
      <div className="scene-layer">
        <CoreScene entry={entry} />
      </div>
      <div className="neural-vignette" />
      <div className="interface-grain" />
      <div className="corner-frame" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      {gated && (
        <section className="permission-gateway" aria-label="Initialize ROOH">
          <div className="gateway-card">
            <div className="gateway-logo">
              <img src="/rooh-logo-transparent.png" alt="ROOH" />
            </div>
            <div className="gateway-copy">
              <small className="gateway-kicker">
                <i /> ROOH / NEURAL LABORATORY
              </small>
              <h1>
                Intelligence,
                <br />
                <em>with presence.</em>
              </h1>
              <p>
                A living holographic intelligence. Speak naturally, explore
                knowledge, and shape your workspace with a gesture.
              </p>
              <div className="gateway-actions">
                <button
                  className="primary-entry"
                  onClick={initialize}
                  disabled={permissionBusy}
                >
                  <span>
                    {permissionBusy
                      ? "REQUESTING ACCESS…"
                      : "ACTIVATE VOICE + CAMERA + HAND CONTROL"}
                  </span>
                  <ChevronRight />
                </button>
                <button className="limited-entry" onClick={limited}>
                  EXPLORE WITHOUT CAMERA
                </button>
              </div>
              <div className="privacy-note">
                <span>MICROPHONE + CAMERA REQUESTED ON ENTRY</span>
                <i />
                <span>CONTROLS STAY WITH YOU</span>
              </div>
            </div>
            <div className="gateway-art-label" aria-hidden="true">
              <span>01 / THE LIVING INTELLIGENCE</span>
              <i />
              <span>NEURAL SYSTEM ONLINE</span>
            </div>
          </div>
          <footer>
            <span>VOICE</span>
            <span>VISION</span>
            <span>GESTURE</span>
            <em>ROOH / 2026</em>
          </footer>
        </section>
      )}
      {(entry === "awakening" || entry === "returning") && (
        <section className="arrival-sequence" aria-live="polite">
          <small>
            {entry === "returning"
              ? "WELCOME BACK · LABORATORY READY"
              : "NEURAL SYSTEM ASSEMBLING"}
          </small>
          {entry === "returning" && (
            <button onClick={initialize}>RESTORE VOICE + GESTURE</button>
          )}
          <button onClick={() => setEntry("active")}>SKIP</button>
        </section>
      )}
      <header className="neural-header">
        <div className="neural-brand">
          <img src="/rooh-logo-transparent.png" alt="" />
          <div>
            <small>HOLOGRAPHIC NEURAL LABORATORY</small>
          </div>
        </div>
      </header>
      {entry === "active" && (
        <a className="avatar-source-credit" href="/avatar/SOURCE.md" target="_blank" rel="noopener noreferrer">
          Infinite, 3D Head Scan · Lee Perry-Smith · CC BY 3.0
        </a>
      )}
      <nav className="workspace-controls" aria-label="کنترل صفحه">
        <button onClick={() => void executeTool("go_back", {})}>Back</button>
        <button onClick={() => useRooH.getState().arrange()}>Arrange windows</button>
        <button onClick={() => void setBrowserFullscreen(!fullscreen).catch(() => set({error:"مرورگر اجازهٔ Fullscreen را نداد."}))}>
          {fullscreen ? "Exit fullscreen" : fullscreenPending ? "Enter fullscreen" : "Fullscreen"}
        </button>
        {!gated && (voiceEnabled ? <VoiceControls onEnd={() => setVoiceEnabled(false)} /> : <button onClick={() => setVoiceEnabled(true)}>Enable voice</button>)}
      </nav>
      <WhatsAppPanel />
      {!gated && <TextChat />}
      <WebsiteBuilder />
      <div className="panel-layer">
        {panels
          .filter((panel) => panel.kind !== "transcript")
          .map((panel) => (
            <SpatialPanel panel={panel} key={panel.id}>
              <SpatialContent kind={panel.kind} />
            </SpatialPanel>
          ))}
      </div>
      {externalModel && (
        <section className="external-model">
          <header>
            <span>
              <b>{externalModel.name}</b>
              <small>
                {externalModel.source?.toUpperCase() || "VERIFIED SOURCE"} ·{" "}
                {externalModel.license || "SOURCE LICENSE"}
              </small>
            </span>
            <button
              onClick={() => set({ externalModel: undefined })}
              aria-label="Close model"
            >
              <X />
            </button>
          </header>
          <iframe
            src={externalModel.viewer_url}
            title={externalModel.name}
            allow="autoplay; fullscreen; xr-spatial-tracking"
            allowFullScreen
          />
        </section>
      )}
      {selected && (
        <div className="model-credit">
          <b>{selected.label}</b>
          <span>{selected.attribution}</span>
          <small>{selected.license}</small>
        </div>
      )}
      {entry === "active" && (
        <div className="spatial-prompt">
          <span>
            {voiceEnabled ? voiceLabels[voice] : "NEURAL SYSTEM READY"}
          </span>
          <small>
            {voiceEnabled
              ? "Try “ROOH, show me what you can explore.”"
              : "Explore with mouse or touch"}
          </small>
        </div>
      )}
      {handEnabled && (
        <GestureControl onDisable={() => setHandEnabled(false)} />
      )}
      {error && (
        <div role="alert" className="error-toast">
          <AlertTriangle />
          <span>{error}</span>
          <button
            onClick={() => set({ error: undefined })}
            aria-label="Dismiss alert"
          >
            <X />
          </button>
        </div>
      )}
    </main>
  );
}
