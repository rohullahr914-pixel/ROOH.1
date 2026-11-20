class RooHAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(960);
    this.position = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    if (input) {
      for (let i = 0; i < input.length; i++) {
        this.pending[this.position++] = input[i];
        if (this.position === this.pending.length) {
          const frame = this.pending;
          this.port.postMessage(frame, [frame.buffer]);
          this.pending = new Float32Array(960);
          this.position = 0;
        }
      }
    }
    for (const channel of outputs[0] || []) channel.fill(0);
    return true;
  }
}

registerProcessor("rooh-audio-capture", RooHAudioCapture);
