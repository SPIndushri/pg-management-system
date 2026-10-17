import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  fullName: z.string().trim().min(1).max(160),
  password: z.string().min(12).max(128),
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(128),
}).strict();
