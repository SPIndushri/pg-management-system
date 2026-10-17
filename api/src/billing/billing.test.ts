import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { hashOpaqueToken } from "../auth/service.js";
import type { AuthRepository, PublicUser } from "../auth/types.js";
import type { BillingRepository } from "./service.js";

const owner: PublicUser = { id: "owner-1", email: "owner@example.test", fullName: "Owner", role: "OWNER" };
const tenant: PublicUser = { id: "tenant-1", email: "tenant@example.test", fullName: "Tenant", role: "TENANT" };
const otherTenant: PublicUser = { ...tenant, id: "tenant-2", email: "other@example.test" };
const admin: PublicUser = { id: "admin-1", email: "admin@example.test", fullName: "Admin", role: "ADMIN" };
const tenancyId = "86d8a2c0-5791-4ce0-a9c5-399cc0b79039";
const invoiceId = "66d8a2c0-5791-4ce0-a9c5-399cc0b79039";
const token = "s".repeat(48); const csrf = "c".repeat(48);
const startDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const endDate = new Date(Date.now() + 86400000 * 40).toISOString().slice(0, 10);
const dueDate = new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10);
const cents = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2)); };
const amount = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;

type Invoice = {
  id: string; tenancyId: string; periodStart: string; periodEnd: string; dueDate: string; amount: string; currencyCode: string; status: string;
  amountPaid: string; balanceDue: string; payments: Array<{ id: string; amount: string; method: string; reference: string | null; idempotencyKey: string; recordedAt: string; status: string }>;
  tenancy: { id: string; tenantId: string; bed: { id: string; label: string; room: { id: string; roomNumber: string; property: { id: string; name: string; city: string; region: string } } } };
};

function memoryRepository(): BillingRepository {
  const invoices = new Map<string, Invoice>();
  const tenantFor = new Map<string, string>([[tenancyId, tenant.id]]);
  let queue: Promise<void> = Promise.resolve();
  const exclusive = async <T>(operation: () => Promise<T> | T): Promise<T> => {
    const prior = queue; let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try { return await operation(); } finally { release(); }
  };
  const summarize = (invoice: Invoice) => {
    const paid = invoice.payments.filter((payment) => payment.status === "SUCCEEDED").reduce((sum, payment) => sum + cents(payment.amount), 0n);
    const due = cents(invoice.amount) - paid;
    invoice.amountPaid = amount(paid); invoice.balanceDue = amount(due < 0n ? 0n : due);
    if (invoice.status !== "VOID" && invoice.status !== "DRAFT") invoice.status = due <= 0n ? "PAID" : invoice.dueDate < new Date().toISOString().slice(0, 10) ? "OVERDUE" : "ISSUED";
    return structuredClone(invoice);
  };
  return {
    async createInvoice(id, input) {
      if (!tenantFor.has(id)) return { kind: "missing-tenancy" };
      if (input.periodStart < startDate || input.periodEnd > endDate) return { kind: "invalid-period" };
      if ([...invoices.values()].some((row) => row.tenancyId === id && row.periodStart === input.periodStart)) return { kind: "duplicate" };
      const row: Invoice = {
        id: invoiceId, tenancyId: id, periodStart: input.periodStart, periodEnd: input.periodEnd, dueDate: input.dueDate,
        amount: amount(cents(input.amount)), currencyCode: input.currencyCode, status: "ISSUED", amountPaid: "0.00", balanceDue: input.amount, payments: [],
        tenancy: { id, tenantId: tenantFor.get(id)!, bed: { id: "bed-1", label: "A", room: { id: "room-1", roomNumber: "1", property: { id: "property-1", name: "Test PG", city: "Pune", region: "MH" } } } },
      };
      invoices.set(row.id, row); return { kind: "created", invoice: summarize(row) };
    },
    async tenantInvoices(userId) { return [...invoices.values()].filter((row) => row.tenancy.tenantId === userId).map(summarize); },
    async tenantInvoice(id, userId) { const row = invoices.get(id); return row?.tenancy.tenantId === userId ? summarize(row) : null; },
    async ownerInvoices(ownerId) { return ownerId === null || ownerId === owner.id ? [...invoices.values()].map(summarize) : []; },
    async ownerInvoice(id) { const row = invoices.get(id); return row ? summarize(row) : null; },
    async recordPayment(id, input, today) {
      return exclusive(async () => {
        const row = invoices.get(id); if (!row) return { kind: "missing-invoice" };
        const recordedAt = new Date(`${input.paymentDate}T00:00:00.000Z`).toISOString();
        const prior = row.payments.find((payment) => payment.idempotencyKey === input.idempotencyKey);
        if (prior) {
          const matches = prior.amount === amount(cents(input.amount)) && prior.method === input.method && prior.reference === (input.reference || null) && prior.recordedAt === recordedAt;
          return matches ? { kind: "replayed", invoice: summarize(row) } : { kind: "idempotency-conflict" };
        }
        if (["VOID", "DRAFT", "PAID"].includes(row.status)) return { kind: "closed-invoice" };
        if (recordedAt.slice(0, 10) > today.toISOString().slice(0, 10)) return { kind: "future-payment-date" };
        const paid = row.payments.filter((payment) => payment.status === "SUCCEEDED").reduce((sum, payment) => sum + cents(payment.amount), 0n);
        if (cents(input.amount) > cents(row.amount) - paid) return { kind: "overpayment" };
        row.payments.push({ id: `payment-${row.payments.length + 1}`, amount: amount(cents(input.amount)), method: input.method, reference: input.reference || null, idempotencyKey: input.idempotencyKey, recordedAt, status: "SUCCEEDED" });
        return { kind: "recorded", invoice: summarize(row) };
      });
    },
  };
}

function authRepository(user: PublicUser): AuthRepository {
  const csrfTokenHash = createHash("sha256").update(csrf).digest("hex");
  return {
    findUserByEmail: async () => null, createAccountAndSession: async () => { throw new Error("unused"); }, createSession: async () => undefined, revokeSession: async () => undefined,
    findSession: async (tokenHash) => tokenHash === hashOpaqueToken(token) ? { sessionId: "session", tokenHash, csrfTokenHash, user } : null,
  };
}
function appFor(user: PublicUser, repository: BillingRepository, tenantId = tenant.id, ownerId = owner.id) {
  const access = async () => ({ tenantId, propertyOwnerId: ownerId });
  return createApp({
    webOrigin: "http://localhost:5173", authRepository: authRepository(user), billingRepository: repository,
    invoiceAccess: access, tenancyAccess: access, propertyRepository: {} as never,
    passwordHasher: { hash: async (value) => value, verify: async () => false },
  });
}
const cookies = `pg_session=${token}; pg_csrf=${csrf}`;
const writes = { Cookie: cookies, "X-CSRF-Token": csrf };
const invoiceInput = (periodStart = startDate) => ({ periodStart, periodEnd: endDate, dueDate, amount: "100.00", currencyCode: "usd" });
const paymentInput = (key: string, value: string) => ({ amount: value, paymentDate: new Date().toISOString().slice(0, 10), method: "UPI", reference: "cashbook-1", idempotencyKey: key });

describe("rent invoices and manual payment tracking", () => {
  it("creates invoices, validates billing periods and rejects duplicate periods", async () => {
    const app = appFor(owner, memoryRepository());
    const created = await request(app).post(`/api/v1/owner/tenancies/${tenancyId}/invoices`).set(writes).send(invoiceInput());
    const duplicate = await request(app).post(`/api/v1/owner/tenancies/${tenancyId}/invoices`).set(writes).send(invoiceInput());
    const invalid = await request(app).post(`/api/v1/owner/tenancies/${tenancyId}/invoices`).set(writes).send({ ...invoiceInput(), periodEnd: startDate });
    const forged = await request(app).post(`/api/v1/owner/tenancies/${tenancyId}/invoices`).set(writes).send({ ...invoiceInput(), tenantId: otherTenant.id, ownerId: "attacker", status: "PAID" });
    expect(created.status).toBe(201); expect(created.body.invoice.status).toBe("ISSUED"); expect(created.body.invoice.currencyCode).toBe("USD");
    expect(duplicate.status).toBe(409); expect(duplicate.body.error.code).toBe("DUPLICATE_INVOICE");
    expect(invalid.status).toBe(400); expect(forged.status).toBe(400);
  });

  it("enforces tenant and owner access isolation and requires authentication", async () => {
    const repository = memoryRepository(); const ownerApp = appFor(owner, repository);
    await request(ownerApp).post(`/api/v1/owner/tenancies/${tenancyId}/invoices`).set(writes).send(invoiceInput());
    expect((await request(appFor(tenant, repository)).get("/api/v1/invoices").set("Cookie", cookies)).body.invoices).toHaveLength(1);
    expect((await request(appFor(tenant, repository)).get(`/api/v1/invoices/${invoiceId}`).set("Cookie", cookies)).status).toBe(200);
    expect((await request(appFor(otherTenant, repository, otherTenant.id)).get(`/api/v1/invoices/${invoiceId}`).set("Cookie", cookies)).status).toBe(404);
    expect((await request(appFor({ ...owner, id: "owner-2" }, repository, tenant.id, owner.id)).get(`/api/v1/owner/invoices/${invoiceId}`).set("Cookie", cookies)).status).toBe(404);
    expect((await request(appFor(tenant, repository)).get("/api/v1/invoices")).status).toBe(401);
    expect((await request(appFor(tenant, repository)).post(`/api/v1/owner/invoices/${invoiceId}/payments`).set(writes).send(paymentInput(crypto.randomUUID(), "10.00"))).status).toBe(403);
  });

  it("records partial and full payments with exact balances and immutable history", async () => {
    const repository = memoryRepository(); const app = appFor(owner, repository);
    await request(app).post(`/api/v1/owner/tenancies/${tenancyId}/invoices`).set(writes).send(invoiceInput());
    const partialKey = crypto.randomUUID(); const fullKey = crypto.randomUUID();
    const partial = await request(app).post(`/api/v1/owner/invoices/${invoiceId}/payments`).set(writes).send(paymentInput(partialKey, "40.10"));
    const full = await request(app).post(`/api/v1/owner/invoices/${invoiceId}/payments`).set(writes).send(paymentInput(fullKey, "59.90"));
    const replay = await request(app).post(`/api/v1/owner/invoices/${invoiceId}/payments`).set(writes).send(paymentInput(fullKey, "59.90"));
    expect(partial.status).toBe(201); expect(partial.body.invoice.amountPaid).toBe("40.10"); expect(partial.body.invoice.balanceDue).toBe("59.90");
    expect(full.status).toBe(201); expect(full.body.invoice.status).toBe("PAID"); expect(full.body.invoice.balanceDue).toBe("0.00");
    expect(replay.status).toBe(200); expect(replay.body.repeated).toBe(true); expect(replay.body.invoice.payments).toHaveLength(2);
  });

  it("rejects overpayments and serializes concurrent attempts against one balance", async () => {
    const repository = memoryRepository(); const app = appFor(owner, repository);
    await request(app).post(`/api/v1/owner/tenancies/${tenancyId}/invoices`).set(writes).send(invoiceInput());
    const overpay = await request(app).post(`/api/v1/owner/invoices/${invoiceId}/payments`).set(writes).send(paymentInput(crypto.randomUUID(), "100.01"));
    expect(overpay.status).toBe(409); expect(overpay.body.error.code).toBe("OVERPAYMENT");
    const attempts = await Promise.all([
      request(app).post(`/api/v1/owner/invoices/${invoiceId}/payments`).set(writes).send(paymentInput(crypto.randomUUID(), "60.00")),
      request(app).post(`/api/v1/owner/invoices/${invoiceId}/payments`).set(writes).send(paymentInput(crypto.randomUUID(), "50.00")),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([201, 409]);
    const detail = await request(app).get(`/api/v1/owner/invoices/${invoiceId}`).set("Cookie", cookies);
    expect(detail.body.invoice.amountPaid).toBe("60.00"); expect(detail.body.invoice.balanceDue).toBe("40.00"); expect(detail.body.invoice.payments).toHaveLength(1);
  });

  it("rejects invalid amounts, future payment dates and missing CSRF", async () => {
    const app = appFor(owner, memoryRepository());
    const invoice = await request(app).post(`/api/v1/owner/tenancies/${tenancyId}/invoices`).set(writes).send(invoiceInput());
    expect(invoice.status).toBe(201);
    expect((await request(app).post(`/api/v1/owner/invoices/${invoiceId}/payments`).set(writes).send(paymentInput(crypto.randomUUID(), "1.001"))).status).toBe(400);
    const future = { ...paymentInput(crypto.randomUUID(), "1.00"), paymentDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) };
    expect((await request(app).post(`/api/v1/owner/invoices/${invoiceId}/payments`).set(writes).send(future)).status).toBe(400);
    expect((await request(app).post(`/api/v1/owner/invoices/${invoiceId}/payments`).set("Cookie", `pg_session=${token}`).send(paymentInput(crypto.randomUUID(), "1.00"))).status).toBe(403);
  });

  it("restricts invoice creation and payment recording to owners and admins", async () => {
    const repo = memoryRepository(); const adminApp = appFor(admin, repo);
    const created = await request(adminApp).post(`/api/v1/owner/tenancies/${tenancyId}/invoices`).set(writes).send(invoiceInput());
    expect(created.status).toBe(201);
    const payment = await request(adminApp).post(`/api/v1/owner/invoices/${invoiceId}/payments`).set(writes).send(paymentInput(crypto.randomUUID(), "1.00"));
    expect(payment.status).toBe(201);
  });
});
