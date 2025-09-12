import z from "zod";

export const Word = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});
export type Word = z.infer<typeof Word>;

export const Utterance = z.object({
  complete: z.array(Word),
  partial: z.array(Word),
  idx: z.number(),
});
export type Utterance = z.infer<typeof Utterance>;
