export type VoiceRuntimeState =
  | "idle"
  | "connecting"
  | "listening"
  | "processing"
  | "speaking"
  | "interrupted"
  | "reconnecting"
  | "disconnected"
  | "error";

// Connection events may recover from errors; completed turns must return to listening.
export function stateTransition(current: VoiceRuntimeState, next: VoiceRuntimeState): VoiceRuntimeState {
  if (next === "connecting" || next === "reconnecting" || next === "disconnected" || next === "error") return next;
  if (current === "disconnected" || current === "error") return current;
  return next;
}

export function applyMicrophoneMute(media: Pick<MediaStream, "getAudioTracks">, muted: boolean) {
  for (const track of media.getAudioTracks()) track.enabled = !muted;
}

export function backoffMs(attempt: number): number {
  const base = Math.min(8000, 600 * 2 ** attempt);
  const jitter = Math.min(base * 0.5, 600);
  return Math.max(500, Math.round(base + Math.random() * jitter));
}

export type VoiceActivityDecision = {
  send: boolean;
  speechStarted: boolean;
  speechEnded: boolean;
};

/**
 * Lightweight client-side VAD. It keeps a short speech hangover so quiet word
 * endings are not clipped and periodically sends one silence frame to keep a
 * long-lived realtime stream healthy without uploading continuous silence.
 */
export class VoiceActivityGate {
  private speaking = false;
  private speechFrames = 0;
  private quietFrames = 0;
  private skippedFrames = 0;

  constructor(
    private readonly startThreshold = 0.018,
    private readonly stopThreshold = 0.011,
    private readonly startFrames = 2,
    private readonly hangoverFrames = 10,
    private readonly keepAliveFrames = 16,
  ) {}

  next(rms: number): VoiceActivityDecision {
    let speechStarted = false;
    let speechEnded = false;

    if (!this.speaking) {
      this.speechFrames = rms >= this.startThreshold ? this.speechFrames + 1 : 0;
      if (this.speechFrames >= this.startFrames) {
        this.speaking = true;
        this.quietFrames = 0;
        this.skippedFrames = 0;
        speechStarted = true;
      }
    } else if (rms < this.stopThreshold) {
      this.quietFrames += 1;
      if (this.quietFrames >= this.hangoverFrames) {
        this.speaking = false;
        this.speechFrames = 0;
        speechEnded = true;
      }
    } else {
      this.quietFrames = 0;
    }

    if (this.speaking || speechEnded) return {send:true,speechStarted,speechEnded};
    this.skippedFrames += 1;
    const keepAlive = this.skippedFrames >= this.keepAliveFrames;
    if (keepAlive) this.skippedFrames = 0;
    return {send:keepAlive,speechStarted:false,speechEnded:false};
  }

  reset() {
    this.speaking = false;
    this.speechFrames = 0;
    this.quietFrames = 0;
    this.skippedFrames = 0;
  }
}

export function pcmRms(input: Float32Array): number {
  let sum = 0;
  for (const value of input) sum += value * value;
  return input.length ? Math.sqrt(sum / input.length) : 0;
}

export function websocketHighWaterMark(effectiveType?: string): number {
  if (effectiveType === "slow-2g" || effectiveType === "2g") return 180_000;
  if (effectiveType === "3g") return 360_000;
  return 1_000_000;
}

/** Ordered microphone frames; a turn boundary cannot overtake buffered audio. */
export class OutgoingAudioQueue {
  private packets: string[] = [];
  private queuedSince?: number;

  constructor(private readonly maxPackets = 80, private readonly maxWaitMs = 5000) {}

  get length() { return this.packets.length; }
  get pending() { return this.packets.length > 0; }

  enqueue(packets: string[], now: number): boolean {
    if (this.packets.length + packets.length > this.maxPackets) return false;
    if (!this.packets.length && packets.length) this.queuedSince = now;
    this.packets.push(...packets);
    return true;
  }

  end(now: number) {
    if (!this.packets.length) this.queuedSince = now;
    this.packets.push(JSON.stringify({type:"input_audio_buffer.commit"}));
  }

  expired(now: number): boolean {
    return this.queuedSince !== undefined && now - this.queuedSince > this.maxWaitMs;
  }

  flush(bufferedAmount: number, highWaterMark: number, send: (packet: string) => void, now: number, batchSize = 6): number {
    if (bufferedAmount > highWaterMark) return 0;
    let sent = 0;
    while (sent < batchSize && this.packets.length) {
      send(this.packets.shift()!);
      sent++;
    }
    if (!this.packets.length) {
      this.queuedSince = undefined;
    } else if (sent) this.queuedSince = now;
    return sent;
  }

  reset() { this.packets = []; this.queuedSince = undefined; }
}

/**
 * Keeps streamed PCM chunks on one gapless timeline. A small initial lead
 * absorbs normal WebSocket jitter; the lead is only re-applied after a real
 * underrun, so adjacent chunks are never separated artificially.
 */
export function schedulePCMChunk(
  currentTime: number,
  queuedUntil: number,
  duration: number,
  startupLead = 0.55,
  schedulingMargin = 0.04,
): { startAt: number; queuedUntil: number } {
  // Scheduling a source only a few milliseconds before the queued audio ends
  // is effectively an underrun on busy browsers. Rebuffer in that case rather
  // than repeatedly producing tiny, audible gaps between PCM chunks.
  const hasSafeLead = queuedUntil > currentTime + schedulingMargin;
  const startAt = hasSafeLead ? queuedUntil : currentTime + startupLead;
  return { startAt, queuedUntil: startAt + duration };
}

/** Adapts playback lead to recent chunk arrival jitter, with safe bounds. */
export class AdaptiveAudioBuffer {
  private lastArrival?: number;
  private lastDuration = 0;
  private jitter = 0;

  constructor(private readonly minimum = 0.55, private readonly maximum = 1.5) {}

  observe(arrivalTime: number, chunkDuration: number): number {
    if (this.lastArrival !== undefined) {
      const deviation = Math.abs(arrivalTime - this.lastArrival - this.lastDuration);
      this.jitter = this.jitter * 0.8 + deviation * 0.2;
    }
    this.lastArrival = arrivalTime;
    this.lastDuration = chunkDuration;
    return this.lead();
  }

  lead(): number {
    return Math.min(this.maximum, Math.max(this.minimum, 0.4 + this.jitter * 4));
  }

  reset() {
    this.lastArrival = undefined;
    this.lastDuration = 0;
    this.jitter = 0;
  }
}

/** Smooths input level changes and uses a noise floor before speech detection. */
export class AdaptiveVoiceActivityGate {
  private floor = 0.003;
  private speaking = false;
  private activeFrames = 0;
  private quietFrames = 0;

  constructor(private readonly startFrames = 3, private readonly hangoverFrames = 10) {}

  get isSpeaking() {
    return this.speaking;
  }

  next(rms: number): { speech: boolean; speechStarted: boolean; speechEnded: boolean } {
    if (!this.speaking && rms < Math.max(0.004, this.floor * 2.2)) {
      this.floor = this.floor * 0.96 + rms * 0.04;
    }
    const threshold = Math.max(0.012, this.floor * 4);
    let speechStarted = false;
    let speechEnded = false;
    if (!this.speaking) {
      this.activeFrames = rms > threshold ? this.activeFrames + 1 : 0;
      if (this.activeFrames >= this.startFrames) {
        this.speaking = true;
        this.quietFrames = 0;
        speechStarted = true;
      }
    } else if (rms < threshold * 0.62) {
      this.quietFrames += 1;
      if (this.quietFrames >= this.hangoverFrames) {
        this.speaking = false;
        this.activeFrames = 0;
        speechEnded = true;
      }
    } else {
      this.quietFrames = 0;
    }
    return { speech: this.speaking || speechEnded, speechStarted, speechEnded };
  }

  reset() {
    this.floor = 0.003;
    this.speaking = false;
    this.activeFrames = 0;
    this.quietFrames = 0;
  }
}
