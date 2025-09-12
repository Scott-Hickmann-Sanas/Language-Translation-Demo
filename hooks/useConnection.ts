import { LTMessage } from "@/types/ltMessages";
import { useCallback, useRef, useState } from "react";
import {
  addAudioStreamToPeerConnection,
  createDataChannel,
  createInputStream,
  createOffer,
  createPeerConnection,
  listenForMessages,
  receiveAnswer,
  startTranslationSession,
} from "../lib/connection";

export function useLanguageTranslationConnection(
  handleMessage: (message: LTMessage) => void,
) {
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const [outputAudio, setOutputAudio] = useState<MediaStream | null>(null);
  const inputStream = useRef<MediaStream | null>(null);

  const stopCall = useCallback(() => {
    if (!peerConnection.current) {
      throw new Error("Not connected to server");
    }
    inputStream.current?.getTracks().forEach((track) => track.stop());
    inputStream.current = null;
    peerConnection.current.close();
    peerConnection.current = null;
    setOutputAudio(null);
  }, []);

  const startCall = useCallback(
    async (config: {
      langIn: string | null;
      langOut: string;
      voiceId: string | null;
      glossary: string[];
    }) => {
      if (peerConnection.current) {
        throw new Error("Already connected to server");
      }
      const inputStream_ = await createInputStream();
      const peerConnection_ = createPeerConnection(setOutputAudio, stopCall);
      const dataChannel = await createDataChannel(peerConnection_);
      addAudioStreamToPeerConnection(peerConnection_, inputStream_);
      const offer = await createOffer(peerConnection_);
      await receiveAnswer(peerConnection_, offer);
      await startTranslationSession(dataChannel, config);
      listenForMessages(dataChannel, handleMessage);
      peerConnection.current = peerConnection_;
      inputStream.current = inputStream_;
    },
    [stopCall, handleMessage],
  );

  return {
    startCall,
    stopCall,
    outputAudio,
  };
}
