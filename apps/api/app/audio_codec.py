"""G.711 mu-law transport for low-bandwidth voice relay."""

def compress_pcm(pcm: bytes) -> bytes:
    if len(pcm) % 2:
        raise ValueError("PCM16 must contain complete samples")
    output = bytearray(len(pcm) // 2)
    for i in range(0, len(pcm), 2):
        sample = int.from_bytes(pcm[i:i + 2], "little", signed=True)
        sign = 0x80 if sample < 0 else 0
        magnitude = min(32635, abs(sample) + 132)
        exponent = max(0, magnitude.bit_length() - 8)
        mantissa = (magnitude >> (exponent + 3)) & 0x0F
        output[i // 2] = ~(sign | (exponent << 4) | mantissa) & 0xFF
    return bytes(output)


def expand_pcm(encoded: bytes) -> bytes:
    output = bytearray(len(encoded) * 2)
    for i, value in enumerate(encoded):
        value = ~value & 0xFF
        magnitude = (((value & 0x0F) << 3) + 132) << ((value >> 4) & 7)
        sample = 132 - magnitude if value & 0x80 else magnitude - 132
        output[i * 2:i * 2 + 2] = max(-32768, min(32767, sample)).to_bytes(2, "little", signed=True)
    return bytes(output)
