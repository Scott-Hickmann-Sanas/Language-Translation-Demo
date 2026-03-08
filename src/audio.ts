/** Convert Float32 PCM samples (range -1..1) to Int16 PCM. */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return int16;
}

/**
 * Acquire a microphone audio track via getUserMedia.
 * The caller owns the returned track and is responsible for stopping it.
 */
export async function getMicrophoneTrack(
  options?: {
    sampleRate?: number;
    // eslint-disable-next-line no-undef
    constraints?: MediaTrackConstraints;
  },
): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: options?.constraints ?? {
      echoCancellation: true,
      noiseSuppression: false,
      sampleRate: options?.sampleRate ?? 16000,
      autoGainControl: true,
    },
  });
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error("No audio track available.");
  return track;
}
