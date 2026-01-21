import { z } from "zod";

import { Delimiter } from "./delimiters";
import { Word } from "./words";

export const ResetMessage = z.object({
  id: z.string(),
  clear_history: z.boolean().optional(),
  lang_in: z.string().nullable(),
  lang_out: z.string(),
  voice_id: z.string().nullable().optional(),
  glossary: z.array(z.string()).nullable().optional(),
  can_lang_swap: z.boolean().optional(),
});
export type ResetMessage = z.infer<typeof ResetMessage>;

export const WrappedResetMessage = z.object({
  type: z.literal("reset"),
  reset: ResetMessage,
});
export type WrappedResetMessage = z.infer<typeof WrappedResetMessage>;

export const WrappedRecordingMessage = z.object({
  type: z.literal("recording"),
  recording: z.enum(["start", "stop"]),
});
export type WrappedRecordingMessage = z.infer<typeof WrappedRecordingMessage>;

export const TranscriptionMessage = z.object({
  complete: z.array(Word),
  partial: z.array(Word),
  lang: z.string().nullable().optional(),
  utterance_idx: z.number(),
});
export type TranscriptionMessage = z.infer<typeof TranscriptionMessage>;

export const WrappedTranscriptionMessage = z.object({
  type: z.literal("transcription"),
  transcription: TranscriptionMessage,
});
export type WrappedTranscriptionMessage = z.infer<
  typeof WrappedTranscriptionMessage
>;

export const TranslationMessage = z.object({
  complete: z.array(Word),
  partial: z.array(Word),
  utterance_idx: z.number(),
});
export type TranslationMessage = z.infer<typeof TranslationMessage>;

export const SpeechDelimiterMessage = z.object({
  time: z.number(),
  transcription: Delimiter,
  translation: Delimiter,
});
export type SpeechDelimiterMessage = z.infer<typeof SpeechDelimiterMessage>;

export const WrappedTranslationMessage = z.object({
  type: z.literal("translation"),
  translation: TranslationMessage,
});
export type WrappedTranslationMessage = z.infer<
  typeof WrappedTranslationMessage
>;

export const WrappedSpeechDelimiterMessage = z.object({
  type: z.literal("speech_delimiter"),
  speech_delimiter: SpeechDelimiterMessage,
});
export type WrappedSpeechDelimiterMessage = z.infer<
  typeof WrappedSpeechDelimiterMessage
>;

export const ReadyMessage = z.object({
  id: z.string().nullable(),
});
export type ReadyMessage = z.infer<typeof ReadyMessage>;

export const WrappedReadyMessage = z.object({
  type: z.literal("ready"),
  ready: ReadyMessage,
});
export type WrappedReadyMessage = z.infer<typeof WrappedReadyMessage>;

// Union Message for all message types
export const LTMessage = z.discriminatedUnion("type", [
  WrappedResetMessage,
  WrappedRecordingMessage,
  WrappedTranscriptionMessage,
  WrappedTranslationMessage,
  WrappedSpeechDelimiterMessage,
  WrappedReadyMessage,
]);

// Type inference
export type LTMessage = z.infer<typeof LTMessage>;
export type LTMessageType = LTMessage["type"];
