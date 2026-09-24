import { z } from "zod";

export const profileQuerySchema = z.strictObject({});

export const profileUpdateSchema = z.strictObject({
  display_name: z.string().trim().min(1).max(100),
});

export type ProfileUpdateInput = z.output<typeof profileUpdateSchema>;
