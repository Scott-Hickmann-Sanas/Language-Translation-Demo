import { useCallback, useState } from "react";

import { LTMessage } from "@/types/ltMessages";
import { Utterance } from "@/types/words";

function updateUtterances(utterance: Utterance) {
  return (prev: Utterance[]) => {
    const lastUtterance = prev[prev.length - 1];
    if (lastUtterance?.idx === utterance.idx) {
      const newLastUtterance = {
        ...lastUtterance,
        complete: [...lastUtterance.complete, ...utterance.complete],
        partial: utterance.partial,
      };
      return [...prev.slice(0, -1), newLastUtterance];
    } else {
      return [...prev, utterance];
    }
  };
}

export function useLanguageTranslationCaptions() {
  const [detectedLangIn, setDetectedLangIn] = useState<string | null>(null);
  const [transcriptions, setTranscriptions] = useState<Utterance[]>([]);
  const [translations, setTranslations] = useState<Utterance[]>([]);

  const reset = useCallback(() => {
    setTranscriptions([]);
    setTranslations([]);
    setDetectedLangIn(null);
  }, []);

  const handleMessage = useCallback((message: LTMessage) => {
    switch (message.type) {
      case "transcription": {
        const {
          complete,
          partial,
          lang,
          utterance_idx: utteranceIdx,
        } = message.transcription;
        setDetectedLangIn(lang ?? "auto");
        setTranscriptions(
          updateUtterances({
            complete,
            partial,
            idx: utteranceIdx,
          }),
        );
        break;
      }
      case "translation": {
        const {
          complete,
          partial,
          utterance_idx: utteranceIdx,
        } = message.translation;
        if (complete.length > 0) {
          setTranslations(
            updateUtterances({
              complete,
              partial,
              idx: utteranceIdx,
            }),
          );
        }
        break;
      }
      case "speech":
        // Can be used to track what text has been spoken
        break;
      default:
        console.error("Unknown message type", message.type);
    }
  }, []);

  return {
    reset,
    state: {
      transcriptions,
      translations,
      detectedLangIn,
    },
    handleMessage,
  };
}
