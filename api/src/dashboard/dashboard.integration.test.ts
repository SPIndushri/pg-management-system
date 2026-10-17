import "../config/env.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../services/prisma.js";
import { createPrismaDashboardRepository } from "./prisma-repository.js";

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const repository = createPrismaDashboardRepository(prisma);
describe.skipIf(!runIntegration)("PostgreSQL dashboard aggregates", () => {
  const suffix = randomUUID();
  let ownerId = ""; let tenantId = ""; let propertyId = ""; let roomId = ""; let bedId = ""; let tenancyId = ""; let invoiceId = ""; let euroInvoiceId = "";
  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: `dashboard-owner-${suffix}@example.invalid`, fullName: "Dashboard owner", passwordHash: "unused-integration-hash", role: "OWNER" }, select: { id: true } })).id;
    tenantId = (await prisma.user.create({ data: { email: `dashboard-tenant-${suffix}@example.invalid`, fullName: "Dashboard tenant", passwordHash: "unused-integration-hash", role: "TENANT" }, select: { id: true } })).id;
    propertyId = (await prisma.property.create({ data: { ownerId, name: `Dashboard ${suffix}`, addressLine1: "Integration test", city: "Test", region: "Test", postalCode: "00000", countryCode: "ZZ", status: "ACTIVE" }, select: { id: true } })).id;
    roomId = (await prisma.room.create({ data: { propertyId, roomNumber: "DASH-1" }, select: { id: true } })).id;
    bedId = (await prisma.bed.create({ data: { roomId, label: "A" }, select: { id: true } })).id;
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 5);
    tenancyId = (await prisma.tenancy.create({ data: { tenantId, bedId, startDate: start, endDate: end, checkedInAt: new Date() }, select: { id: true } })).id;
    await prisma.booking.create({ data: { tenantId, bedId, startDate: end, endDate: new Date(end.getTime() + 86_400_000), status: "PENDING" } });
    invoiceId = (await prisma.rentInvoice.create({ data: { tenancyId, periodStart: start, periodEnd: end, dueDate: new Date(start.getTime() - 86_400_000), amount: "100.00", currencyCode: "INR", status: "ISSUED" }, select: { id: true } })).id;
    await prisma.payment.create({ data: { invoiceId, amount: "25.00", currencyCode: "INR", status: "SUCCEEDED", method: "CASH", recordedAt: new Date() } });
    euroInvoiceId = (await prisma.rentInvoice.create({ data: { tenancyId, periodStart: new Date(start.getTime() + 86_400_000), periodEnd: end, dueDate: new Date(start.getTime() - 86_400_000), amount: "10.00", currencyCode: "EUR", status: "ISSUED" }, select: { id: true } })).id;
    await prisma.payment.create({ data: { invoiceId: euroInvoiceId, amount: "3.00", currencyCode: "EUR", status: "SUCCEEDED", method: "BANK_TRANSFER", recordedAt: new Date() } });
    await prisma.complaint.create({ data: { tenantId, propertyId, tenancyId, roomId, bedId, title: "Dashboard repair", description: "A maintenance issue used to verify scoped dashboard counts.", category: "OTHER", status: "OPEN" } });
  });
  afterAll(async () => {
    if (propertyId) { await prisma.complaintActivity.deleteMany({ where: { complaint: { propertyId } } }); await prisma.complaint.deleteMany({ where: { propertyId } }); }
    const invoiceIds = [invoiceId, euroInvoiceId].filter(Boolean);
    if (invoiceIds.length) await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    if (tenancyId) await prisma.rentInvoice.deleteMany({ where: { tenancyId } });
    if (bedId) await prisma.booking.deleteMany({ where: { bedId } });
    if (tenancyId) await prisma.tenancy.deleteMany({ where: { id: tenancyId } });
    if (bedId) await prisma.bed.deleteMany({ where: { id: bedId } });
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    if (propertyId) await prisma.property.deleteMany({ where: { id: propertyId } });
    const ids = [ownerId, tenantId].filter(Boolean); if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });
  it("calculates actual scoped portfolio totals, invoice balances, payments, and tenant summaries", async () => {
    const now = new Date(); const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const from = new Date(today); from.setUTCDate(from.getUTCDate() - 5);
    const toExclusive = new Date(today); toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    const range = { from, toExclusive, asOf: today };
    const owner = await repository.owner(ownerId, range) as { properties: { total: number; rooms: number }; bookings: Record<string, number>; invoices: { byCurrency: Array<{ currencyCode: string; outstandingBalance: string; overdueBalance: string; overdueInvoiceCount: number }> }; payments: { recordedAmountInRangeByCurrency: Array<{ currencyCode: string; amount: string }> }; maintenance: Record<string, number> };
    expect(owner.properties.total).toBe(1); expect(owner.properties.rooms).toBe(1);
    const inr = owner.invoices.byCurrency.find((row) => row.currencyCode === "INR");
    const eur = owner.invoices.byCurrency.find((row) => row.currencyCode === "EUR");
    expect(owner.bookings.PENDING).toBe(1); expect(inr?.outstandingBalance).toBe("75.00"); expect(inr?.overdueBalance).toBe("75.00");
    expect(eur?.outstandingBalance).toBe("7.00");
    expect(inr?.overdueInvoiceCount).toBe(1); expect(owner.payments.recordedAmountInRangeByCurrency).toContainEqual({ currencyCode: "INR", amount: "25.00" }); expect(owner.maintenance.OPEN).toBe(1);
    expect(owner.payments.recordedAmountInRangeByCurrency).toContainEqual({ currencyCode: "EUR", amount: "3.00" });
    const tenant = await repository.tenant(tenantId, range) as { currentTenancies: { count: number }; invoices: Array<{ currencyCode: string; balanceDue: string }>; recentPayments: unknown[]; maintenance: { openOrInProgressCount: number } };
    expect(tenant.currentTenancies.count).toBe(1); expect(tenant.invoices.find((row) => row.currencyCode === "INR")?.balanceDue).toBe("75.00"); expect(tenant.invoices.find((row) => row.currencyCode === "EUR")?.balanceDue).toBe("7.00"); expect(tenant.recentPayments).toHaveLength(2); expect(tenant.maintenance.openOrInProgressCount).toBe(1);
    const otherOwner = await repository.owner(randomUUID(), range) as { properties: { total: number }; invoices: { byCurrency: unknown[] }; payments: { recordedAmountInRangeByCurrency: unknown[] } };
    expect(otherOwner.properties.total).toBe(0); expect(otherOwner.invoices.byCurrency).toEqual([]); expect(otherOwner.payments.recordedAmountInRangeByCurrency).toEqual([]);
  });
});
