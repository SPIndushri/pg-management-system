export type InvoiceStatus = "DRAFT" | "ISSUED" | "PAID" | "OVERDUE" | "VOID";
export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "UPI" | "CARD" | "CHEQUE" | "OTHER";
export interface RecordedPayment {
  id: string; amount: string; currencyCode: string; status: string; method: PaymentMethod;
  reference: string | null; recordedAt: string | null; createdAt: string;
}
export interface RentInvoice {
  id: string; tenancyId: string; periodStart: string; periodEnd: string; dueDate: string;
  amount: string; amountPaid: string; balanceDue: string; currencyCode: string; status: InvoiceStatus;
  payments: RecordedPayment[];
  tenancy: { id: string; tenantId: string; tenant: { id: string; fullName: string; email: string }; bed: { id: string; label: string; room: { id: string; roomNumber: string; property: { id: string; name: string; city: string; region: string } } } };
}
interface ApiError { error?: { message?: string; issues?: Array<{ path: Array<string | number>; message: string }> } }
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");
export class BillingApiError extends Error { constructor(message: string, readonly status: number) { super(message); this.name = "BillingApiError"; } }

async function call<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const headers = new Headers();
  if (data !== undefined) headers.set("Content-Type", "application/json");
  if (method !== "GET") {
    const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("pg_csrf="));
    if (cookie) headers.set("X-CSRF-Token", decodeURIComponent(cookie.slice("pg_csrf=".length)));
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, credentials: "include", ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as ApiError;
    const issues = payload.error?.issues?.map((item) => `${item.path.join(".")}: ${item.message}`).join(" · ");
    throw new BillingApiError(issues || payload.error?.message || "The billing request could not be completed.", response.status);
  }
  return response.json() as Promise<T>;
}

export const billingApi = {
  tenantList: () => call<{ invoices: RentInvoice[] }>("/invoices"),
  ownerList: () => call<{ invoices: RentInvoice[] }>("/owner/invoices"),
  createInvoice: (tenancyId: string, input: { periodStart: string; periodEnd: string; dueDate: string; amount: string; currencyCode: string }) =>
    call<{ invoice: RentInvoice }>(`/owner/tenancies/${encodeURIComponent(tenancyId)}/invoices`, "POST", input),
  recordPayment: (invoiceId: string, input: { amount: string; paymentDate: string; method: PaymentMethod; reference?: string; idempotencyKey: string }) =>
    call<{ invoice: RentInvoice; repeated: boolean }>(`/owner/invoices/${encodeURIComponent(invoiceId)}/payments`, "POST", input),
};
