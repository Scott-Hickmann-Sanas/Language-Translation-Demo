import { z } from "zod";

import { StreamV3ServerMessage } from "./streamV3Messages";

export const ConnectionState = z.enum([
  "disconnected",
  "connecting",
  "connected",
]);
export type ConnectionState = z.infer<typeof ConnectionState>;

export const TransportStreamMessage = z.object({
  type: z.literal("transport"),
  state: ConnectionState,
});
export type TransportStreamMessage = z.infer<typeof TransportStreamMessage>;

export const StreamMessage = z.union([
  TransportStreamMessage,
  StreamV3ServerMessage,
]);
export type StreamMessage = z.infer<typeof StreamMessage>;
