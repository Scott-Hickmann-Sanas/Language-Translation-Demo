import { LTMessage } from "@/types/ltMessages";

if (!process.env.NEXT_PUBLIC_LT_ENDPOINT) {
  throw new Error("NEXT_PUBLIC_LT_ENDPOINT is not set");
}
const LT_ENDPOINT = process.env.NEXT_PUBLIC_LT_ENDPOINT;

if (!process.env.NEXT_PUBLIC_SANAS_API_KEY) {
  throw new Error("NEXT_PUBLIC_SANAS_API_KEY is not set");
}
const SANAS_API_KEY = process.env.NEXT_PUBLIC_SANAS_API_KEY;

const SAMPLE_RATE = 24000;

// Step 1: Create input audio stream
export async function createInputStream() {
  const inputStream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: {
      echoCancellation: true,
      noiseSuppression: false,
      sampleRate: SAMPLE_RATE,
      autoGainControl: true,
    },
  });
  const audioTrack = inputStream.getAudioTracks()[0];
  if (!audioTrack) {
    throw new Error("No audio track found");
  }
  audioTrack.enabled = true;
  return inputStream;
}

// Step 2: Create peer connection
export function createPeerConnection(
  onAudioTrack: (audioTrack: MediaStream) => void,
  stopCall: () => void,
) {
  const peerConnection = new RTCPeerConnection();

  peerConnection.ontrack = (e) => {
    onAudioTrack(e.streams[0]);
  };

  // onconnectionstatechange: Log and handle disconnects
  peerConnection.onconnectionstatechange = () => {
    console.log(`connection state: ${peerConnection.connectionState}`);
    if (
      peerConnection.connectionState === "disconnected" ||
      peerConnection.connectionState === "failed" ||
      peerConnection.connectionState === "closed"
    ) {
      stopCall();
    }
  };

  return peerConnection;
}

// Step 3: Add audio stream to peer connection
export function addAudioStreamToPeerConnection(
  peerConnection: RTCPeerConnection,
  inputStream: MediaStream,
) {
  inputStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, inputStream);
  });
}

// Step 4: Create offer
export async function createOffer(peerConnection: RTCPeerConnection) {
  const offer = await peerConnection.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: false,
    iceRestart: true,
  });
  await peerConnection.setLocalDescription(offer);
  return offer;
}

// Step 5: Send offer to server, receive answer, and set remote description
export async function receiveAnswer(
  peerConnection: RTCPeerConnection,
  offer: RTCSessionDescriptionInit,
) {
  const sdpResponse = await fetch(`${LT_ENDPOINT}/session`, {
    method: "POST",
    body: JSON.stringify({
      ...offer,
      input_sample_rate: SAMPLE_RATE,
      output_sample_rate: SAMPLE_RATE,
    }),
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": SANAS_API_KEY,
    },
  });
  if (!sdpResponse.ok) {
    const errorText = await sdpResponse.text();
    throw new Error(`Error: ${errorText}`);
  }
  const answer = await sdpResponse.json();
  await peerConnection.setRemoteDescription(answer);
}

// Step 6: Create data channel
export async function createDataChannel(peerConnection: RTCPeerConnection) {
  const dataChannel = peerConnection.createDataChannel("messaging");
  return dataChannel;
}

// Step 7: Start translation session
export async function startTranslationSession(
  dataChannel: RTCDataChannel,
  {
    langIn,
    langOut,
    voiceId,
    glossary,
  }: {
    langIn: string | null;
    langOut: string;
    voiceId: string | null;
    glossary: string[];
  },
) {
  // Wait for data channel to be open
  await new Promise((resolve, reject) => {
    const removeListeners = () => {
      dataChannel.removeEventListener("open", onOpen);
      dataChannel.removeEventListener("error", onError);
    };
    const onOpen = () => {
      removeListeners();
      resolve(true);
    };
    const onError = (event: Event) => {
      removeListeners();
      reject(new Error(`Error: ${event.type}`));
    };
    dataChannel.addEventListener("open", onOpen);
    dataChannel.addEventListener("error", onError);
  });

  // Send reset message, and wait for corresponding ready message
  const resetMessage: LTMessage = {
    type: "reset",
    reset: {
      id: window.crypto.randomUUID(),
      lang_in: langIn,
      lang_out: langOut,
      voice_id: voiceId,
      glossary: glossary,
    },
  };
  console.log("Sending reset message", resetMessage);
  await new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const message: LTMessage = JSON.parse(event.data);
      if (
        message.type === "ready" &&
        message.ready.id === resetMessage.reset.id
      ) {
        resolve(true);
        dataChannel.removeEventListener("message", onMessage);
      }
    };
    dataChannel.addEventListener("message", onMessage);
    dataChannel.send(JSON.stringify(resetMessage));
  });
  console.log("Language translation session ready");
}

// Step 8: Listen for messages on data channel
export function listenForMessages(
  dataChannel: RTCDataChannel,
  handleMessage: (message: LTMessage) => void,
) {
  dataChannel.addEventListener("message", (event: MessageEvent) => {
    const message: LTMessage = JSON.parse(event.data);
    handleMessage(message);
  });
}
