import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date.");
export const dashboardQuerySchema = z.object({ from: isoDate.optional(), to: isoDate.optional() }).strict()
  .refine(({ from, to }) => !from || !to || from <= to, { message: "The end date must be on or after the start date.", path: ["to"] })
  .refine(({ from }) => !from || from <= new Date().toISOString().slice(0, 10), { message: "Report dates cannot be in the future.", path: ["from"] })
  .refine(({ to }) => !to || to <= new Date().toISOString().slice(0, 10), { message: "Report dates cannot be in the future.", path: ["to"] });
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
