export function pcmToUlaw(pcm: Int16Array): Uint8Array {
  const encoded = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const sample = pcm[i];
    const sign = sample < 0 ? 0x80 : 0;
    const magnitude = Math.min(32635, Math.abs(sample) + 132);
    const exponent = Math.max(0, Math.floor(Math.log2(magnitude)) - 7);
    const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
    encoded[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return encoded;
}

export function ulawToPcm(encoded: Uint8Array): Int16Array {
  const pcm = new Int16Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    const value = ~encoded[i] & 0xff;
    const magnitude = (((value & 0x0f) << 3) + 132) << ((value >> 4) & 7);
    pcm[i] = Math.max(-32768, Math.min(32767, value & 0x80 ? 132 - magnitude : magnitude - 132));
  }
  return pcm;
}
