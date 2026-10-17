import { Prisma, type PrismaClient } from "@prisma/client";
import type { BillingRepository } from "./service.js";
import type { CreateInvoiceInput, RecordPaymentInput } from "./schemas.js";

const invoiceSelect = {
  id: true, tenancyId: true, periodStart: true, periodEnd: true, dueDate: true,
  amount: true, currencyCode: true, status: true, createdAt: true, updatedAt: true,
  tenancy: {
    select: {
      id: true, tenantId: true, tenant: { select: { id: true, fullName: true, email: true } },
      bed: { select: { id: true, label: true, room: { select: { id: true, roomNumber: true, property: { select: { id: true, name: true, city: true, region: true } } } } } },
    },
  },
  payments: { orderBy: [{ recordedAt: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.RentInvoiceSelect;

type InvoiceRow = Prisma.RentInvoiceGetPayload<{ select: typeof invoiceSelect }>;
const utcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const decimal = (value: string) => new Prisma.Decimal(value);

function summarize(invoice: InvoiceRow, today = new Date()): Record<string, unknown> {
  const paid = invoice.payments.reduce((total, payment) => payment.status === "SUCCEEDED" ? total.plus(payment.amount) : total, new Prisma.Decimal(0));
  const balance = Prisma.Decimal.max(new Prisma.Decimal(0), invoice.amount.minus(paid));
  const status = invoice.status === "VOID" ? "VOID"
    : invoice.status === "DRAFT" ? "DRAFT"
      : balance.isZero() ? "PAID"
        : invoice.dueDate < new Date(`${today.toISOString().slice(0, 10)}T00:00:00.000Z`) ? "OVERDUE" : "ISSUED";
  return {
    ...invoice,
    amount: invoice.amount.toFixed(2),
    currencyCode: invoice.currencyCode.trim(),
    status,
    amountPaid: paid.toFixed(2),
    balanceDue: balance.toFixed(2),
    payments: invoice.payments.map((payment) => ({ ...payment, amount: payment.amount.toFixed(2) })),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export function createPrismaBillingRepository(prisma: PrismaClient): BillingRepository {
  return {
    async createInvoice(tenancyId: string, input: CreateInvoiceInput, today: Date) {
      const tenancy = await prisma.tenancy.findUnique({
        where: { id: tenancyId },
        select: { id: true, status: true, startDate: true, endDate: true },
      });
      if (!tenancy) return { kind: "missing-tenancy" as const };
      if (tenancy.status !== "ACTIVE" && tenancy.status !== "ENDED") return { kind: "ineligible-tenancy" as const };
      const start = utcDate(input.periodStart); const end = utcDate(input.periodEnd);
      if (start < tenancy.startDate || (tenancy.endDate && end > tenancy.endDate)) return { kind: "invalid-period" as const };
      try {
        const invoice = await prisma.rentInvoice.create({
          data: {
            tenancyId, periodStart: start, periodEnd: end, dueDate: utcDate(input.dueDate),
            amount: decimal(input.amount), currencyCode: input.currencyCode,
            status: utcDate(input.dueDate) < today ? "OVERDUE" : "ISSUED",
          },
          select: invoiceSelect,
        });
        return { kind: "created" as const, invoice: summarize(invoice, today) };
      } catch (error) {
        if (isUniqueViolation(error)) return { kind: "duplicate" as const };
        throw error;
      }
    },

    async tenantInvoices(tenantId) {
      const rows = await prisma.rentInvoice.findMany({ where: { tenancy: { tenantId } }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], select: invoiceSelect });
      return rows.map((invoice) => summarize(invoice));
    },
    async tenantInvoice(invoiceId, tenantId) {
      const invoice = await prisma.rentInvoice.findFirst({ where: { id: invoiceId, tenancy: { tenantId } }, select: invoiceSelect });
      return invoice ? summarize(invoice) : null;
    },
    async ownerInvoices(ownerId) {
      const rows = await prisma.rentInvoice.findMany({
        where: ownerId ? { tenancy: { bed: { room: { property: { ownerId } } } } } : {},
        orderBy: [{ dueDate: "asc" }, { id: "asc" }], select: invoiceSelect,
      });
      return rows.map((invoice) => summarize(invoice));
    },
    async ownerInvoice(invoiceId) {
      const invoice = await prisma.rentInvoice.findUnique({ where: { id: invoiceId }, select: invoiceSelect });
      return invoice ? summarize(invoice) : null;
    },

    async recordPayment(invoiceId: string, input: RecordPaymentInput, today: Date) {
      return prisma.$transaction(async (transaction) => {
        // The invoice row serializes all supported payment attempts for this balance.
        const locked = await transaction.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "RentInvoice" WHERE "id" = ${invoiceId}::uuid FOR UPDATE`;
        if (locked.length === 0) return { kind: "missing-invoice" as const };
        const existing = await transaction.payment.findUnique({
          where: { invoiceId_idempotencyKey: { invoiceId, idempotencyKey: input.idempotencyKey } },
          select: { id: true, amount: true, method: true, reference: true, recordedAt: true, status: true },
        });
        const recordedAt = utcDate(input.paymentDate);
        if (existing) {
          const sameRequest = existing.amount.equals(decimal(input.amount))
            && existing.method === input.method
            && existing.reference === (input.reference || null)
            && existing.recordedAt?.getTime() === recordedAt.getTime();
          if (!sameRequest) return { kind: "idempotency-conflict" as const };
          const invoice = await transaction.rentInvoice.findUnique({ where: { id: invoiceId }, select: invoiceSelect });
          return { kind: "replayed" as const, invoice: invoice ? summarize(invoice, today) : undefined };
        }

        const invoice = await transaction.rentInvoice.findUnique({ where: { id: invoiceId }, select: invoiceSelect });
        if (!invoice) return { kind: "missing-invoice" as const };
        if (invoice.status === "VOID" || invoice.status === "DRAFT" || invoice.status === "PAID") return { kind: "closed-invoice" as const };
        if (recordedAt > today) return { kind: "future-payment-date" as const };
        const paid = invoice.payments.reduce((total, payment) => payment.status === "SUCCEEDED" ? total.plus(payment.amount) : total, new Prisma.Decimal(0));
        const amount = decimal(input.amount);
        const balance = invoice.amount.minus(paid);
        if (amount.greaterThan(balance)) return { kind: "overpayment" as const };

        await transaction.payment.create({
          data: {
            invoiceId, amount, currencyCode: invoice.currencyCode,
            status: "SUCCEEDED", method: input.method, reference: input.reference || null,
            idempotencyKey: input.idempotencyKey, recordedAt,
          },
        });
        const newPaid = paid.plus(amount);
        const status = newPaid.greaterThanOrEqualTo(invoice.amount) ? "PAID" : invoice.dueDate < today ? "OVERDUE" : "ISSUED";
        await transaction.rentInvoice.update({ where: { id: invoiceId }, data: { status } });
        const updated = await transaction.rentInvoice.findUnique({ where: { id: invoiceId }, select: invoiceSelect });
        return { kind: "recorded" as const, invoice: updated ? summarize(updated, today) : undefined };
      }, { maxWait: 5_000, timeout: 10_000 });
    },
  };
}
