import z from "zod";

export const Delimiter = z.object({
  utterance_idx: z.number(),
  word_idx: z.number(),
  char_idx: z.number(),
});
export type Delimiter = z.infer<typeof Delimiter>;
