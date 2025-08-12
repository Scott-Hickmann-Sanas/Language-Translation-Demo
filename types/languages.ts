import { z } from "zod";

export const Language = z.object({
  long_code: z.string(),
  short_code: z.string(),
  name: z.string(),
  support: z.enum(["alpha", "beta", "stable"]),
});

export type Language = z.infer<typeof Language>;

export const Languages = z.array(Language);
export type Languages = z.infer<typeof Languages>;
