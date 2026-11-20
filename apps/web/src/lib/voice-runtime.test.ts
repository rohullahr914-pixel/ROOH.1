import { describe, expect, it } from "vitest";
import { AdaptiveAudioBuffer, AdaptiveVoiceActivityGate, OutgoingAudioQueue, applyMicrophoneMute, backoffMs, pcmRms, schedulePCMChunk, stateTransition, VoiceActivityGate, websocketHighWaterMark } from "./voice-runtime";

describe("voice runtime guardrails", () => {
  it("keeps interruption transitions deterministic", () => {
    expect(stateTransition("speaking", "interrupted")).toBe("interrupted");
    expect(stateTransition("interrupted", "listening")).toBe("listening");
    expect(stateTransition("processing", "speaking")).toBe("speaking");
    expect(stateTransition("idle", "error")).toBe("error");
  });

  it("uses bounded exponential backoff with jitter", () => {
    expect(backoffMs(0)).toBeGreaterThanOrEqual(500);
    expect(backoffMs(0)).toBeLessThanOrEqual(900);
    expect(backoffMs(3)).toBeGreaterThanOrEqual(4800);
    expect(backoffMs(3)).toBeLessThanOrEqual(5400);
  });

  it("suppresses silence while retaining periodic keep-alive audio", () => {
    const gate = new VoiceActivityGate(0.02, 0.01, 2, 3, 4);
    expect(gate.next(0).send).toBe(false);
    expect(gate.next(0).send).toBe(false);
    expect(gate.next(0).send).toBe(false);
    expect(gate.next(0).send).toBe(true);
  });

  it("uses hysteresis and a hangover around speech", () => {
    const gate = new VoiceActivityGate(0.02, 0.01, 2, 2, 20);
    expect(gate.next(0.03).speechStarted).toBe(false);
    expect(gate.next(0.03).speechStarted).toBe(true);
    expect(gate.next(0).speechEnded).toBe(false);
    expect(gate.next(0).speechEnded).toBe(true);
  });

  it("does not treat faint background noise as speech", () => {
    const gate = new AdaptiveVoiceActivityGate();
    for (let frame = 0; frame < 20; frame += 1) {
      expect(gate.next(0.009).speechStarted).toBe(false);
    }
    for (let frame = 0; frame < 2; frame += 1) {
      expect(gate.next(0.03).speechStarted).toBe(false);
    }
    expect(gate.next(0.03).speechStarted).toBe(true);
  });

  it("keeps enough playback lead for a jittery VPN route", () => {
    expect(new AdaptiveAudioBuffer().lead()).toBeCloseTo(0.55);
  });

  it("measures input energy and lowers buffering on weak networks", () => {
    expect(pcmRms(new Float32Array([1, -1]))).toBe(1);
    expect(websocketHighWaterMark("2g")).toBeLessThan(websocketHighWaterMark("4g"));
  });

  it("buffers the first PCM chunk and schedules following chunks without gaps", () => {
    const first = schedulePCMChunk(10, 0, 0.2);
    expect(first.startAt).toBeCloseTo(10.55);
    const second = schedulePCMChunk(10.05, first.queuedUntil, 0.2);
    expect(second.startAt).toBeCloseTo(first.queuedUntil);
    expect(second.queuedUntil).toBeCloseTo(10.95);
  });

  it("re-buffers when the remaining scheduling window is too small", () => {
    const next = schedulePCMChunk(10, 10.02, 0.1, 0.55, 0.04);
    expect(next.startAt).toBeCloseTo(10.55);
  });

  it("rebuilds playback lead after an underrun", () => {
    const next = schedulePCMChunk(20, 19.5, 0.1);
    expect(next.startAt).toBeCloseTo(20.55);
  });
});


describe("voice recovery and microphone privacy", () => {
  it.each(["processing", "reconnecting", "speaking", "interrupted", "connecting"] as const)("returns from %s to listening after completion", state => {
    expect(stateTransition(state, "listening")).toBe("listening");
  });
  it("can explicitly retry after an error without accepting late playback", () => {
    expect(stateTransition("error", "speaking")).toBe("error");
    expect(stateTransition("error", "connecting")).toBe("connecting");
    expect(stateTransition("disconnected", "speaking")).toBe("disconnected");
  });
  it("keeps replacement microphone tracks muted on reconnect", () => {
    const original = {enabled:true}, replacement = {enabled:true};
    applyMicrophoneMute({getAudioTracks:()=>[original as MediaStreamTrack]}, true);
    applyMicrophoneMute({getAudioTracks:()=>[replacement as MediaStreamTrack]}, true);
    expect(original.enabled).toBe(false);
    expect(replacement.enabled).toBe(false);
    applyMicrophoneMute({getAudioTracks:()=>[replacement as MediaStreamTrack]}, false);
    expect(replacement.enabled).toBe(true);
  });
});

describe("outgoing audio under network congestion", () => {
  it("drains audio in order and keeps the turn boundary behind the queued frames", () => {
    const queue = new OutgoingAudioQueue();
    const sent: string[] = [];
    expect(queue.enqueue(["a", "b"], 0)).toBe(true);
    queue.end(1);
    expect(queue.flush(200, 100, packet => sent.push(packet), 2)).toBe(0);
    expect(queue.enqueue(["c"], 3)).toBe(true);
    queue.flush(0, 100, packet => sent.push(packet), 4, 2);
    queue.flush(0, 100, packet => sent.push(packet), 5, 2);
    expect(sent).toEqual(["a", "b", JSON.stringify({type:"input_audio_buffer.commit"}), "c"]);
    expect(queue.pending).toBe(false);
  });

  it("reports overflow and a stalled upload instead of silently dropping speech", () => {
    const queue = new OutgoingAudioQueue(2, 100);
    expect(queue.enqueue(["a", "b"], 0)).toBe(true);
    expect(queue.enqueue(["c"], 1)).toBe(false);
    expect(queue.length).toBe(2);
    expect(queue.expired(101)).toBe(true);
    queue.reset();
    expect(queue.pending).toBe(false);
  });
});
