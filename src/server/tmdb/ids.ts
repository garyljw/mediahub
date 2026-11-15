import "server-only";
import { z } from "zod";

// Plain digits, positive, at most 100,000,000 (the same ceiling as the add actions). Anything else is not a TMDB id.
export const tmdbIdParam = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
  .refine((n) => n > 0 && n <= 100_000_000);
