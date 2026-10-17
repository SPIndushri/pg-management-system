import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date.");

const decimalAmount = z.string()
  .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, "Enter an amount with up to 10 whole digits and 2 decimal places.")
  .refine((value) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2)) > 0n;
  }, "Amount must be greater than zero.");

export const createInvoiceSchema = z.object({
  periodStart: isoDate,
  periodEnd: isoDate,
  dueDate: isoDate,
  amount: decimalAmount,
  currencyCode: z.string().regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code.").transform((value) => value.toUpperCase()),
}).strict().refine(({ periodStart, periodEnd }) => periodStart < periodEnd, {
  message: "Billing period end must be after its start.", path: ["periodEnd"],
});

export const recordPaymentSchema = z.object({
  amount: decimalAmount,
  paymentDate: isoDate,
  method: z.enum(["CASH", "BANK_TRANSFER", "UPI", "CARD", "CHEQUE", "OTHER"]),
  reference: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().uuid(),
}).strict();

export const invoiceIdParamsSchema = z.object({ invoiceId: z.string().uuid() });
export const tenancyIdParamsSchema = z.object({ tenancyId: z.string().uuid() });

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
