import type { CreateInvoiceInput, RecordPaymentInput } from "./schemas.js";

export type InvoiceCreateResult = "created" | "duplicate" | "missing-tenancy" | "ineligible-tenancy" | "invalid-period";
export type PaymentRecordResult = "recorded" | "replayed" | "missing-invoice" | "closed-invoice" | "overpayment" | "idempotency-conflict" | "future-payment-date";

export interface BillingRepository {
  createInvoice(tenancyId: string, input: CreateInvoiceInput, today: Date): Promise<{ kind: InvoiceCreateResult; invoice?: unknown }>;
  tenantInvoices(tenantId: string): Promise<unknown>;
  tenantInvoice(invoiceId: string, tenantId: string): Promise<unknown | null>;
  ownerInvoices(ownerId: string | null): Promise<unknown>;
  ownerInvoice(invoiceId: string): Promise<unknown | null>;
  recordPayment(invoiceId: string, input: RecordPaymentInput, today: Date): Promise<{ kind: PaymentRecordResult; invoice?: unknown }>;
}

export class BillingWorkflowError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "BillingWorkflowError"; }
}

const utcDay = (date: Date) => new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);

export class BillingService {
  constructor(private readonly repository: BillingRepository, private readonly now: () => Date = () => new Date()) {}

  async createInvoice(tenancyId: string, input: CreateInvoiceInput) {
    const result = await this.repository.createInvoice(tenancyId, input, utcDay(this.now()));
    if (result.kind === "missing-tenancy") throw new BillingWorkflowError(404, "NOT_FOUND", "Tenancy not found.");
    if (result.kind === "ineligible-tenancy") throw new BillingWorkflowError(409, "INELIGIBLE_TENANCY", "Invoices can only be created for an active or ended tenancy.");
    if (result.kind === "invalid-period") throw new BillingWorkflowError(400, "INVALID_BILLING_PERIOD", "The billing period must fall within the tenancy dates.");
    if (result.kind === "duplicate") throw new BillingWorkflowError(409, "DUPLICATE_INVOICE", "An invoice already exists for this tenancy and billing period start.");
    return result.invoice;
  }

  tenantInvoices(tenantId: string) { return this.repository.tenantInvoices(tenantId); }
  tenantInvoice(invoiceId: string, tenantId: string) { return this.repository.tenantInvoice(invoiceId, tenantId); }
  ownerInvoices(ownerId: string | null) { return this.repository.ownerInvoices(ownerId); }
  ownerInvoice(invoiceId: string) { return this.repository.ownerInvoice(invoiceId); }

  async recordPayment(invoiceId: string, input: RecordPaymentInput) {
    const today = utcDay(this.now());
    if (new Date(`${input.paymentDate}T00:00:00.000Z`) > today) {
      throw new BillingWorkflowError(400, "INVALID_PAYMENT_DATE", "Payment date cannot be in the future.");
    }
    const result = await this.repository.recordPayment(invoiceId, input, today);
    if (result.kind === "missing-invoice") throw new BillingWorkflowError(404, "NOT_FOUND", "Invoice not found.");
    if (result.kind === "closed-invoice") throw new BillingWorkflowError(409, "INVOICE_NOT_PAYABLE", "This invoice is not open for payment.");
    if (result.kind === "overpayment") throw new BillingWorkflowError(409, "OVERPAYMENT", "Payment exceeds the outstanding invoice balance.");
    if (result.kind === "idempotency-conflict") throw new BillingWorkflowError(409, "IDEMPOTENCY_KEY_REUSED", "This payment request key was already used with different details.");
    if (result.kind === "future-payment-date") throw new BillingWorkflowError(400, "INVALID_PAYMENT_DATE", "Payment date cannot be in the future.");
    return { invoice: result.invoice, repeated: result.kind === "replayed" };
  }
}
