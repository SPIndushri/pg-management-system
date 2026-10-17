import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
export const propertyCreateSchema = z.object({
  name: text(160), description: z.string().trim().max(5000).optional().nullable(),
  addressLine1: text(200), addressLine2: z.string().trim().max(200).optional().nullable(),
  city: text(120), region: text(120), postalCode: text(24), countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((v) => v.toUpperCase()),
}).strict();
export const propertyUpdateSchema = propertyCreateSchema.partial().extend({ status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]).optional() }).strict();
export const roomCreateSchema = z.object({ roomNumber: text(40), floor: z.number().int().min(-5).max(200).optional().nullable() }).strict();
export const roomUpdateSchema = roomCreateSchema.partial().extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() }).strict();
export const bedCreateSchema = z.object({ label: text(40) }).strict();
export const bedUpdateSchema = bedCreateSchema.partial().extend({ status: z.enum(["AVAILABLE", "MAINTENANCE", "INACTIVE"]).optional() }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const parsed = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}, "Expected a valid date");
export const browseQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(12),
  city: z.string().trim().min(1).max(120).optional(), search: z.string().trim().min(1).max(120).optional(),
  startDate: date.optional(), endDate: date.optional(),
}).strict().refine((q) => !q.startDate || !q.endDate || q.startDate < q.endDate, { message: "endDate must be after startDate", path: ["endDate"] });
export type PropertyInput = z.infer<typeof propertyCreateSchema>;
export type PropertyUpdate = z.infer<typeof propertyUpdateSchema>;
export type RoomInput = z.infer<typeof roomCreateSchema>;
export type RoomUpdate = z.infer<typeof roomUpdateSchema>;
export type BedInput = z.infer<typeof bedCreateSchema>;
export type BedUpdate = z.infer<typeof bedUpdateSchema>;
export type BrowseQuery = z.infer<typeof browseQuerySchema>;
