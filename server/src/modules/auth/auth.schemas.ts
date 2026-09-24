import { z } from "zod";

export const credentialsSchema = z.strictObject({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});

export const emptyAuthQuerySchema = z.strictObject({});
export const absentAuthBodySchema = z.undefined();
export type Credentials = z.infer<typeof credentialsSchema>;
