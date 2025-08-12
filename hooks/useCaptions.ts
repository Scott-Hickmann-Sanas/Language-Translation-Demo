import { LTMessage } from "@/types/ltMessages";
import { Phrase, Word } from "@/types/words";
import { useCallback, useState } from "react";

export function useLanguageTranslationCaptions() {
  const [pendingTranscriptions, setPendingTranscriptions] = useState<Word[]>(
    [],
  );
  const [completeTranscriptions, setCompleteTranscriptions] = useState<
    Phrase[]
  >([]);
  const [pendingTranslations, setPendingTranslations] = useState<Word[]>([]);
  const [completeTranslations, setCompleteTranslations] = useState<Phrase[]>(
    [],
  );

  const handleMessage = useCallback((message: LTMessage) => {
    switch (message.type) {
      case "transcription":
        if (message.transcription.type === "complete") {
          if (message.transcription.transcriptions.length > 0) {
            setCompleteTranscriptions((completeTranscriptions) => [
              ...completeTranscriptions,
              message.transcription.transcriptions,
            ]);
          }
          setPendingTranscriptions([]);
        } else {
          setPendingTranscriptions(message.transcription.transcriptions);
        }
        break;
      case "translation":
        if (message.translation.type === "complete") {
          if (message.translation.translations.length > 0) {
            setCompleteTranslations((completeTranslations) => [
              ...completeTranslations,
              message.translation.translations,
            ]);
          }
          setPendingTranslations([]);
        } else {
          setPendingTranslations(message.translation.translations);
        }
        break;
      default:
        console.error("Unknown message type", message.type);
    }
  }, []);

  const reset = useCallback(() => {
    setPendingTranscriptions([]);
    setCompleteTranscriptions([]);
    setPendingTranslations([]);
    setCompleteTranslations([]);
  }, []);

  return {
    reset,
    state: {
      pendingTranscriptions,
      completeTranscriptions,
      pendingTranslations,
      completeTranslations,
    },
    handleMessage,
  };
}
