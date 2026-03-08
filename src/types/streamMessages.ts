import { z } from "zod";

import { LTMessage } from "./ltMessages";

export const ConnectionState = z.enum([
  "disconnected",
  "connecting",
  "connected",
]);
export type ConnectionState = z.infer<typeof ConnectionState>;

export const LTStreamMessage = z.object({
  type: z.literal("lt"),
  lt: LTMessage,
});
export type LTStreamMessage = z.infer<typeof LTStreamMessage>;

export const TransportStreamMessage = z.object({
  type: z.literal("transport"),
  state: ConnectionState,
});
export type TransportStreamMessage = z.infer<typeof TransportStreamMessage>;

export const ErrorStreamMessage = z.object({
  type: z.literal("error"),
  message: z.string(),
});
export type ErrorStreamMessage = z.infer<typeof ErrorStreamMessage>;

export const StreamMessage = z.discriminatedUnion("type", [
  LTStreamMessage,
  TransportStreamMessage,
  ErrorStreamMessage,
]);
export type StreamMessage = z.infer<typeof StreamMessage>;
