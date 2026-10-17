import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date.");

export const createBookingSchema = z.object({
  bedId: z.string().uuid(),
  startDate: isoDate,
  endDate: isoDate,
}).strict().refine(({ startDate, endDate }) => startDate < endDate, {
  message: "End date must be after start date.", path: ["endDate"],
}).refine(({ startDate }) => startDate >= new Date().toISOString().slice(0, 10), {
  message: "Start date cannot be in the past.", path: ["startDate"],
});

export const ownerBookingQuerySchema = z.object({
  propertyId: z.string().uuid().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "REJECTED", "CANCELLED"]).optional(),
}).strict();

export const bookingIdParamsSchema = z.object({ bookingId: z.string().uuid() });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type OwnerBookingQuery = z.infer<typeof ownerBookingQuerySchema>;
