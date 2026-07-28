import { z } from "zod";

import { Word } from "./words";

export const StreamV3LanguageRoute = z.object({
  lang_in: z.string(),
  lang_out: z.string(),
});
export type StreamV3LanguageRoute = z.infer<typeof StreamV3LanguageRoute>;

export const StreamV3GlossaryEntry = z.object({
  terms: z.record(z.string(), z.string()),
});
export type StreamV3GlossaryEntry = z.infer<typeof StreamV3GlossaryEntry>;

export const StreamV3InitMessage = z.object({
  type: z.literal("init"),
  conversation_id: z.string(),
  session_name: z.string(),
  input_sample_rate: z.number(),
  output_sample_rate: z.number(),
  realtime_playback: z.boolean(),
});
export type StreamV3InitMessage = z.infer<typeof StreamV3InitMessage>;

export const StreamV3ConfigureMessage = z.object({
  type: z.literal("configure"),
  language_routes: z.array(StreamV3LanguageRoute),
  features: z.array(z.string()).optional(),
  voice_id: z.string().nullable().optional(),
  glossary: z.array(StreamV3GlossaryEntry).optional(),
  request_id: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
});
export type StreamV3ConfigureMessage = z.infer<typeof StreamV3ConfigureMessage>;

export const StreamV3FlushMessage = z.object({
  type: z.literal("flush"),
  request_id: z.string().nullable().optional(),
});
export type StreamV3FlushMessage = z.infer<typeof StreamV3FlushMessage>;

export const StreamV3ClientMessage = z.discriminatedUnion("type", [
  StreamV3InitMessage,
  StreamV3ConfigureMessage,
  StreamV3FlushMessage,
]);
export type StreamV3ClientMessage = z.infer<typeof StreamV3ClientMessage>;

export const StreamV3TextPosition = z.object({
  word_idx: z.number(),
  char_idx: z.number(),
});
export type StreamV3TextPosition = z.infer<typeof StreamV3TextPosition>;

export const StreamV3IdentifiedLanguage = z.object({
  short_code: z.string(),
  name: z.string(),
  probability: z.number(),
});
export type StreamV3IdentifiedLanguage = z.infer<
  typeof StreamV3IdentifiedLanguage
>;

export const StreamV3ConfiguredMessage = z.object({
  type: z.literal("configured"),
  request_id: z.string().nullable().optional(),
});
export type StreamV3ConfiguredMessage = z.infer<
  typeof StreamV3ConfiguredMessage
>;

export const StreamV3InputSpeechStartedMessage = z.object({
  type: z.literal("input_speech_started"),
  utterance_idx: z.number(),
  input_time: z.number(),
});
export type StreamV3InputSpeechStartedMessage = z.infer<
  typeof StreamV3InputSpeechStartedMessage
>;

export const StreamV3LanguageRouteMessage = z.object({
  type: z.literal("language_route"),
  utterance_idx: z.number(),
  lang_in: z.string(),
  lang_out: z.string(),
});
export type StreamV3LanguageRouteMessage = z.infer<
  typeof StreamV3LanguageRouteMessage
>;

export const StreamV3TranscriptionMessage = z.object({
  type: z.literal("transcription"),
  utterance_idx: z.number(),
  complete: z.array(Word),
  partial: z.array(Word),
});
export type StreamV3TranscriptionMessage = z.infer<
  typeof StreamV3TranscriptionMessage
>;

export const StreamV3TranscriptionEndedMessage = z.object({
  type: z.literal("transcription_ended"),
  utterance_idx: z.number(),
});
export type StreamV3TranscriptionEndedMessage = z.infer<
  typeof StreamV3TranscriptionEndedMessage
>;

export const StreamV3TranslationMessage = z.object({
  type: z.literal("translation"),
  utterance_idx: z.number(),
  complete: z.array(Word),
  partial: z.array(Word),
});
export type StreamV3TranslationMessage = z.infer<
  typeof StreamV3TranslationMessage
>;

export const StreamV3TranslationEndedMessage = z.object({
  type: z.literal("translation_ended"),
  utterance_idx: z.number(),
});
export type StreamV3TranslationEndedMessage = z.infer<
  typeof StreamV3TranslationEndedMessage
>;

export const StreamV3InputSpeechEndedMessage = z.object({
  type: z.literal("input_speech_ended"),
  utterance_idx: z.number(),
  input_time: z.number(),
});
export type StreamV3InputSpeechEndedMessage = z.infer<
  typeof StreamV3InputSpeechEndedMessage
>;

export const StreamV3OutputSpeechStartedMessage = z.object({
  type: z.literal("output_speech_started"),
  utterance_idx: z.number(),
  output_time: z.number(),
});
export type StreamV3OutputSpeechStartedMessage = z.infer<
  typeof StreamV3OutputSpeechStartedMessage
>;

export const StreamV3OutputTextBoundaryMessage = z.object({
  type: z.literal("output_text_boundary"),
  utterance_idx: z.number(),
  output_time: z.number(),
  transcription: StreamV3TextPosition.nullish(),
  translation: StreamV3TextPosition.nullish(),
});
export type StreamV3OutputTextBoundaryMessage = z.infer<
  typeof StreamV3OutputTextBoundaryMessage
>;

export const StreamV3OutputSpeechEndedMessage = z.object({
  type: z.literal("output_speech_ended"),
  utterance_idx: z.number(),
  output_time: z.number(),
});
export type StreamV3OutputSpeechEndedMessage = z.infer<
  typeof StreamV3OutputSpeechEndedMessage
>;

export const StreamV3FlushedMessage = z.object({
  type: z.literal("flushed"),
  request_id: z.string().nullable().optional(),
});
export type StreamV3FlushedMessage = z.infer<typeof StreamV3FlushedMessage>;

export const StreamV3ErrorMessage = z.object({
  type: z.literal("error"),
  message: z.string(),
  code: z.string().optional(),
  utterance_idx: z.number().nullable().optional(),
  request_id: z.string().nullable().optional(),
});
export type StreamV3ErrorMessage = z.infer<typeof StreamV3ErrorMessage>;

export const StreamV3IdentifiedLanguagesMessage = z.object({
  type: z.literal("identified_languages"),
  languages: z.array(StreamV3IdentifiedLanguage),
});
export type StreamV3IdentifiedLanguagesMessage = z.infer<
  typeof StreamV3IdentifiedLanguagesMessage
>;

export const StreamV3ServerMessage = z.discriminatedUnion("type", [
  StreamV3ConfiguredMessage,
  StreamV3InputSpeechStartedMessage,
  StreamV3LanguageRouteMessage,
  StreamV3TranscriptionMessage,
  StreamV3TranscriptionEndedMessage,
  StreamV3TranslationMessage,
  StreamV3TranslationEndedMessage,
  StreamV3InputSpeechEndedMessage,
  StreamV3OutputSpeechStartedMessage,
  StreamV3OutputTextBoundaryMessage,
  StreamV3OutputSpeechEndedMessage,
  StreamV3FlushedMessage,
  StreamV3ErrorMessage,
  StreamV3IdentifiedLanguagesMessage,
]);
export type StreamV3ServerMessage = z.infer<typeof StreamV3ServerMessage>;
