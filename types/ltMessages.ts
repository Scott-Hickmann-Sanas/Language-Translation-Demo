import { z } from "zod";
import { Word } from "./words";

export const ResetMessage = z.object({
  id: z.string(),
  clear_history: z.boolean().optional(),
  lang_in: z.string(),
  lang_out: z.string(),
  voice_id: z.string().nullable().optional(),
  glossary: z.array(z.string()).nullable().optional(),
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
  type: z.enum(["partial", "complete"]),
  transcriptions: z.array(Word),
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
  type: z.enum(["partial", "complete"]),
  translations: z.array(Word),
});
export type TranslationMessage = z.infer<typeof TranslationMessage>;

export const WrappedTranslationMessage = z.object({
  type: z.literal("translation"),
  translation: TranslationMessage,
});
export type WrappedTranslationMessage = z.infer<
  typeof WrappedTranslationMessage
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
  WrappedReadyMessage,
]);

// Type inference
export type LTMessage = z.infer<typeof LTMessage>;
export type LTMessageType = LTMessage["type"];
