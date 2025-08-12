import z from "zod";

export const Word = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});
export type Word = z.infer<typeof Word>;

export type Phrase = Word[];
