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
