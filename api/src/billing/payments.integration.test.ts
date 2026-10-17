import "../config/env.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../services/prisma.js";
import { createPrismaBillingRepository } from "./prisma-repository.js";

const enabled = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const repository = createPrismaBillingRepository(prisma);
const utcDay = (offset = 0) => {
  const date = new Date(); date.setUTCHours(0, 0, 0, 0); date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const invoiceInput = (offset: number, amount = "100.00") => ({
  periodStart: utcDay(offset), periodEnd: utcDay(offset + 5), dueDate: utcDay(offset + 8), amount, currencyCode: "USD",
});
const payment = (amount: string) => ({ amount, paymentDate: utcDay(), method: "CASH" as const, idempotencyKey: randomUUID() });

describe.skipIf(!enabled)("PostgreSQL invoice/payment integration", () => {
  const suffix = randomUUID();
  let ownerId = ""; let tenantId = ""; let propertyId = ""; let roomId = ""; let bedId = ""; let tenancyId = "";

  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: `billing-owner-${suffix}@example.invalid`, fullName: "Billing test owner", passwordHash: "unused-integration-hash", role: "OWNER" }, select: { id: true } })).id;
    tenantId = (await prisma.user.create({ data: { email: `billing-tenant-${suffix}@example.invalid`, fullName: "Billing test tenant", passwordHash: "unused-integration-hash", role: "TENANT" }, select: { id: true } })).id;
    propertyId = (await prisma.property.create({ data: { ownerId, name: `Billing integration ${suffix}`, addressLine1: "Integration only", city: "Test city", region: "Test region", postalCode: "00000", countryCode: "ZZ" }, select: { id: true } })).id;
    roomId = (await prisma.room.create({ data: { propertyId, roomNumber: "BILL-1" }, select: { id: true } })).id;
    bedId = (await prisma.bed.create({ data: { roomId, label: "BILL-A" }, select: { id: true } })).id;
    tenancyId = (await prisma.tenancy.create({ data: { tenantId, bedId, startDate: new Date(`${utcDay(-30)}T00:00:00Z`), endDate: new Date(`${utcDay(365)}T00:00:00Z`), status: "ACTIVE" }, select: { id: true } })).id;
  });

  afterAll(async () => {
    if (tenancyId) {
      const invoices = await prisma.rentInvoice.findMany({ where: { tenancyId }, select: { id: true } });
      const invoiceIds = invoices.map((invoice) => invoice.id);
      if (invoiceIds.length) {
        await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await prisma.rentInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      await prisma.tenancy.deleteMany({ where: { id: tenancyId } });
    }
    if (bedId) await prisma.bed.deleteMany({ where: { id: bedId } });
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    if (propertyId) await prisma.property.deleteMany({ where: { id: propertyId } });
    const userIds = [ownerId, tenantId].filter(Boolean);
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("enforces duplicate billing periods and records partial then full payment history", async () => {
    const today = new Date(`${utcDay()}T00:00:00Z`); const firstPeriod = { ...invoiceInput(-25), dueDate: utcDay(-17) };
    const created = await repository.createInvoice(tenancyId, firstPeriod, today);
    expect(created.kind).toBe("created");
    expect((await repository.createInvoice(tenancyId, firstPeriod, today)).kind).toBe("duplicate");
    const invoiceId = (created.invoice as { id: string }).id;
    const partial = await repository.recordPayment(invoiceId, payment("35.25"), today);
    const full = await repository.recordPayment(invoiceId, payment("64.75"), today);
    expect(partial.kind).toBe("recorded");
    expect((partial.invoice as { status: string }).status).toBe("OVERDUE");
    expect((partial.invoice as { balanceDue: string }).balanceDue).toBe("64.75");
    expect(full.kind).toBe("recorded");
    expect((full.invoice as { status: string; balanceDue: string; payments: unknown[] }).status).toBe("PAID");
    expect((full.invoice as { balanceDue: string }).balanceDue).toBe("0.00");
    expect((full.invoice as { payments: unknown[] }).payments).toHaveLength(2);
  });

  it("serializes concurrent payment attempts and enforces balance and idempotency", async () => {
    const today = new Date(`${utcDay()}T00:00:00Z`);
    const created = await repository.createInvoice(tenancyId, invoiceInput(15), today);
    const invoiceId = (created.invoice as { id: string }).id;
    const key = randomUUID();
    const inputA = { ...payment("60.00"), idempotencyKey: key };
    const inputB = payment("50.00");
    const [first, second] = await Promise.all([
      repository.recordPayment(invoiceId, inputA, today),
      repository.recordPayment(invoiceId, inputB, today),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(["overpayment", "recorded"]);
    const accepted = first.kind === "recorded" ? first : second;
    const acceptedInput = first.kind === "recorded" ? inputA : inputB;
    const replay = await repository.recordPayment(invoiceId, acceptedInput, today);
    expect(replay.kind).toBe("replayed");
    const summary = await repository.ownerInvoice(invoiceId) as { amountPaid: string; balanceDue: string; payments: unknown[] };
    expect(summary.amountPaid).toBe((accepted.invoice as { amountPaid: string }).amountPaid);
    // Either request can acquire the invoice lock first; verify the stored balance
    // matches the one accepted amount instead of assuming which concurrent call wins.
    expect(summary.balanceDue).toBe((accepted.invoice as { balanceDue: string }).balanceDue);
    expect(summary.payments).toHaveLength(1);
  });
});
