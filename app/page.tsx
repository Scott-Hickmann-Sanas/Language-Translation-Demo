"use client";

import { useLanguages } from "@/hooks/useLanguages";
import { useLanguageTranslationConnection } from "@/hooks/useConnection";
import { useLanguageTranslationCaptions } from "@/hooks/useCaptions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Utterance } from "@/types/words";
import UtteranceComponent from "@/components/utterance";

interface GroupedUtterance {
  transcription: Utterance;
  translation: Utterance;
  idx: number;
}

export default function Demo() {
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { state, handleMessage, reset } = useLanguageTranslationCaptions();
  const { startCall, stopCall, outputAudio } =
    useLanguageTranslationConnection(handleMessage);
  const audio = useRef<HTMLAudioElement | null>(null);

  const [langIn, setLangIn] = useState<string | null>(null);
  const [langOut, setLangOut] = useState<string>("fr-FR");

  const config = useMemo(
    () => ({
      langIn: langIn,
      langOut: langOut,
      voiceId: null,
      glossary: [],
    }),
    [langIn, langOut],
  );

  const languages = useLanguages();

  useEffect(() => {
    if (audio.current) {
      audio.current.srcObject = outputAudio;
    }
  }, [outputAudio]);

  const startCallWrapper = useCallback(() => {
    setIsRunning(true);
    setIsLoading(true);
    startCall(config)
      .catch(alert)
      .finally(() => setIsLoading(false));
  }, [startCall, config]);

  const stopCallWrapper = useCallback(() => {
    setIsRunning(false);
    stopCall();
    reset();
  }, [stopCall, reset]);

  const langInName = useMemo(
    () =>
      config.langIn
        ? (languages.find((language) => language.long_code === config.langIn)
            ?.name ?? config.langIn)
        : "Auto",
    [languages, config.langIn],
  );

  const langOutName = useMemo(
    () =>
      languages.find((language) => language.long_code === config.langOut)
        ?.name ?? config.langOut,
    [languages, config.langOut],
  );

  const detectedLangInName = useMemo(
    () =>
      languages.find((language) => language.long_code === state.detectedLangIn)
        ?.name ?? state.detectedLangIn,
    [languages, state.detectedLangIn],
  );

  const groupedUtterances = useMemo(() => {
    const groupedUtterances: GroupedUtterance[] = [];
    for (
      let i = 0;
      i < Math.max(state.transcriptions.length, state.translations.length);
      i++
    ) {
      const grouped: GroupedUtterance = {
        transcription: state.transcriptions[i] ?? {
          complete: [],
          partial: [],
          idx: i,
        },
        translation: state.translations[i] ?? {
          complete: [],
          partial: [],
          idx: i,
        },
        idx: i,
      };
      groupedUtterances.push(grouped);
    }
    return groupedUtterances;
  }, [state.transcriptions, state.translations]);

  return (
    <>
      <div className="m-6 p-6 max-w-lg mx-auto bg-white rounded-xl border-2 border-gray-200 space-y-4">
        <h1 className="text-2xl font-bold text-center text-gray-800">
          Language Translation Demo
        </h1>
        <h2 className="text-xl font-semibold text-gray-700 text-center">
          {langInName} to {langOutName}
        </h2>
        <select
          value={langIn ?? "auto"}
          onChange={(e) =>
            e.target.value === "auto"
              ? setLangIn(null)
              : setLangIn(e.target.value)
          }
          className="w-full p-2 border border-gray-300 rounded-md"
        >
          <option value="auto">Auto</option>
          {languages.map((language) => (
            <option key={language.long_code} value={language.long_code}>
              {language.name}
            </option>
          ))}
        </select>
        <select
          value={langOut}
          onChange={(e) => setLangOut(e.target.value)}
          className="w-full p-2 border border-gray-300 rounded-md"
        >
          {languages.map((language) => (
            <option key={language.long_code} value={language.long_code}>
              {language.name}
            </option>
          ))}
        </select>
        <div className="flex justify-center space-x-4">
          {isLoading ? (
            <div className="text-center text-gray-500">Loading...</div>
          ) : isRunning ? (
            <button
              onClick={stopCallWrapper}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 cursor-pointer"
            >
              Stop Call
            </button>
          ) : (
            <button
              onClick={startCallWrapper}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
            >
              Start Call
            </button>
          )}
        </div>
        {!isLoading && isRunning ? (
          <div className="flex flex-col gap-4">
            {langIn === null && (
              <div>{detectedLangInName ?? "Detecting language..."}</div>
            )}
            {groupedUtterances.map((utterance, index) => (
              <UtteranceComponent key={index} utterance={utterance} />
            ))}
          </div>
        ) : null}
      </div>
      <audio ref={audio} autoPlay className="w-full mt-4" />
    </>
  );
}
