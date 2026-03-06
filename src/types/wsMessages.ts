import { z } from "zod";

import { Delimiter } from "./delimiters";
import { Word } from "./words";

export const WSReadyMessage = z.object({
  type: z.literal("ready"),
  session_id: z.string().optional(),
});
export type WSReadyMessage = z.infer<typeof WSReadyMessage>;

export const WSTranscriptionMessage = z.object({
  type: z.literal("transcription"),
  complete: z.array(Word),
  partial: z.array(Word),
});
export type WSTranscriptionMessage = z.infer<typeof WSTranscriptionMessage>;

export const WSTranslationMessage = z.object({
  type: z.literal("translation"),
  complete: z.array(Word),
  partial: z.array(Word),
});
export type WSTranslationMessage = z.infer<typeof WSTranslationMessage>;

export const WSSpeechDelimiterMessage = z.object({
  type: z.literal("speech_delimiter"),
  time: z.number(),
  transcription: Delimiter,
  translation: Delimiter,
});
export type WSSpeechDelimiterMessage = z.infer<typeof WSSpeechDelimiterMessage>;

export const WSLanguagesMessage = z.object({
  type: z.literal("languages"),
  lang_in: z.string(),
  lang_out: z.string(),
});
export type WSLanguagesMessage = z.infer<typeof WSLanguagesMessage>;

export const WSAudioMessage = z.object({
  type: z.literal("audio"),
  data: z.string(),
});
export type WSAudioMessage = z.infer<typeof WSAudioMessage>;

export const WSSpeechStopMessage = z.object({
  type: z.literal("speech_stop"),
  utterance_idx: z.number(),
});
export type WSSpeechStopMessage = z.infer<typeof WSSpeechStopMessage>;

export const WSErrorMessage = z.object({
  type: z.literal("error"),
  message: z.string(),
  code: z.number().optional(),
});
export type WSErrorMessage = z.infer<typeof WSErrorMessage>;

export const WSMessage = z.discriminatedUnion("type", [
  WSReadyMessage,
  WSTranscriptionMessage,
  WSTranslationMessage,
  WSSpeechDelimiterMessage,
  WSLanguagesMessage,
  WSAudioMessage,
  WSSpeechStopMessage,
  WSErrorMessage,
]);
export type WSMessage = z.infer<typeof WSMessage>;
