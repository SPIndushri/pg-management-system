import "../config/env.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../services/prisma.js";
import { createPrismaBookingRepository } from "./prisma-repository.js";
import { createPrismaTenancyRepository } from "../tenancies/prisma-repository.js";

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const repo = createPrismaBookingRepository(prisma);
const tenancyRepo = createPrismaTenancyRepository(prisma);
const dates = () => {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() + 20);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 3);
  const adjacentEnd = new Date(end); adjacentEnd.setUTCDate(adjacentEnd.getUTCDate() + 2);
  const laterStart = new Date(end); laterStart.setUTCDate(laterStart.getUTCDate() + 10);
  const laterEnd = new Date(laterStart); laterEnd.setUTCDate(laterEnd.getUTCDate() + 3);
  const toDate = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toDate(start), end: toDate(end), adjacentEnd: toDate(adjacentEnd), laterStart: toDate(laterStart), laterEnd: toDate(laterEnd) };
};

describe.skipIf(!runIntegration)("PostgreSQL booking concurrency integration", () => {
  const suffix = randomUUID();
  let ownerId = ""; let tenantAId = ""; let tenantBId = ""; let propertyId = ""; let roomId = "";
  let bedAId = ""; let bedBId = ""; let bedCId = "";

  beforeAll(async () => {
    const owner = await prisma.user.create({ data: { email: `booking-owner-${suffix}@example.invalid`, fullName: "Booking test owner", passwordHash: "unused-integration-hash", role: "OWNER" }, select: { id: true } });
    ownerId = owner.id;
    tenantAId = (await prisma.user.create({ data: { email: `booking-tenant-a-${suffix}@example.invalid`, fullName: "Booking test tenant A", passwordHash: "unused-integration-hash", role: "TENANT" }, select: { id: true } })).id;
    tenantBId = (await prisma.user.create({ data: { email: `booking-tenant-b-${suffix}@example.invalid`, fullName: "Booking test tenant B", passwordHash: "unused-integration-hash", role: "TENANT" }, select: { id: true } })).id;
    const property = await prisma.property.create({ data: { ownerId, name: `Booking integration ${suffix}`, addressLine1: "Integration only", city: "Test city", region: "Test region", postalCode: "00000", countryCode: "ZZ", status: "ACTIVE" }, select: { id: true } });
    propertyId = property.id;
    const room = await prisma.room.create({ data: { propertyId, roomNumber: "IT-1" }, select: { id: true } });
    roomId = room.id;
    bedAId = (await prisma.bed.create({ data: { roomId, label: "A" }, select: { id: true } })).id;
    bedBId = (await prisma.bed.create({ data: { roomId, label: "B" }, select: { id: true } })).id;
    bedCId = (await prisma.bed.create({ data: { roomId, label: "C" }, select: { id: true } })).id;
  });

  afterAll(async () => {
    const bedIds = [bedAId, bedBId, bedCId].filter(Boolean);
    if (bedIds.length) {
      await prisma.tenancy.deleteMany({ where: { bedId: { in: bedIds } } });
      await prisma.booking.deleteMany({ where: { bedId: { in: bedIds } } });
      await prisma.bed.deleteMany({ where: { id: { in: bedIds } } });
    }
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    if (propertyId) await prisma.property.deleteMany({ where: { id: propertyId } });
    const userIds = [ownerId, tenantAId, tenantBId].filter(Boolean);
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("serializes overlapping approval requests and permits adjacent half-open ranges", async () => {
    const d = dates();
    const [first, second] = await Promise.all([
      prisma.booking.create({ data: { tenantId: tenantAId, bedId: bedAId, startDate: new Date(`${d.start}T00:00:00Z`), endDate: new Date(`${d.end}T00:00:00Z`) }, select: { id: true } }),
      prisma.booking.create({ data: { tenantId: tenantBId, bedId: bedAId, startDate: new Date(`${d.start}T00:00:00Z`), endDate: new Date(`${d.end}T00:00:00Z`) }, select: { id: true } }),
    ]);
    const approvals = await Promise.all([repo.approvePending(first.id, new Date()), repo.approvePending(second.id, new Date())]);
    expect(approvals.filter((result) => result === "ok")).toHaveLength(1);
    expect(approvals.filter((result) => result === "conflict")).toHaveLength(1);

    const adjacent = await prisma.booking.create({ data: { tenantId: tenantBId, bedId: bedAId, startDate: new Date(`${d.end}T00:00:00Z`), endDate: new Date(`${d.adjacentEnd}T00:00:00Z`) }, select: { id: true } });
    expect(await repo.approvePending(adjacent.id, new Date())).toBe("ok");
  });

  it("enforces the PostgreSQL exclusion constraint even when writes bypass the service", async () => {
    const d = dates();
    const [first, second] = await Promise.all([
      prisma.booking.create({ data: { tenantId: tenantAId, bedId: bedCId, startDate: new Date(`${d.laterStart}T00:00:00Z`), endDate: new Date(`${d.laterEnd}T00:00:00Z`) }, select: { id: true } }),
      prisma.booking.create({ data: { tenantId: tenantBId, bedId: bedCId, startDate: new Date(`${d.laterStart}T00:00:00Z`), endDate: new Date(`${d.laterEnd}T00:00:00Z`) }, select: { id: true } }),
    ]);
    const results = await Promise.allSettled([
      prisma.booking.update({ where: { id: first.id }, data: { status: "CONFIRMED" } }),
      prisma.booking.update({ where: { id: second.id }, data: { status: "CONFIRMED" } }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("rejects approval when an active tenancy already overlaps", async () => {
    const d = dates();
    const booking = await prisma.booking.create({ data: { tenantId: tenantAId, bedId: bedBId, startDate: new Date(`${d.start}T00:00:00Z`), endDate: new Date(`${d.end}T00:00:00Z`) }, select: { id: true } });
    await prisma.tenancy.create({ data: { tenantId: tenantBId, bedId: bedBId, startDate: new Date(`${d.start}T00:00:00Z`), endDate: new Date(`${d.end}T00:00:00Z`), status: "ACTIVE" } });
    expect(await repo.approvePending(booking.id, new Date())).toBe("conflict");
  });

  it("converts a confirmed booking once and permits an adjacent booking during concurrent approval", async () => {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const end = new Date(today); end.setUTCDate(end.getUTCDate() + 3);
    const adjacentEnd = new Date(end); adjacentEnd.setUTCDate(adjacentEnd.getUTCDate() + 2);
    const source = await prisma.booking.create({ data: { tenantId: tenantAId, bedId: bedCId, startDate: today, endDate: end, status: "CONFIRMED" }, select: { id: true } });
    const adjacent = await prisma.booking.create({ data: { tenantId: tenantBId, bedId: bedCId, startDate: end, endDate: adjacentEnd }, select: { id: true } });
    const [converted, approval] = await Promise.all([
      tenancyRepo.convertConfirmedBooking(source.id, today, new Date()),
      repo.approvePending(adjacent.id, today),
    ]);
    expect(converted.kind).toBe("created");
    expect(approval).toBe("ok");
    const retry = await tenancyRepo.convertConfirmedBooking(source.id, today, new Date());
    expect(retry.kind).toBe("existing");
    expect((retry.tenancy as { id: string }).id).toBe((converted.tenancy as { id: string }).id);
    expect(await prisma.tenancy.count({ where: { bookingId: source.id } })).toBe(1);
  });

  it("rejects conversion against another active tenancy and preserves half-open tenancy ranges", async () => {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const end = new Date(today); end.setUTCDate(end.getUTCDate() + 3);
    const later = new Date(end); later.setUTCDate(later.getUTCDate() + 2);
    const blocked = await prisma.tenancy.create({ data: { tenantId: tenantAId, bedId: bedBId, startDate: today, endDate: end }, select: { id: true } });
    const source = await prisma.booking.create({ data: { tenantId: tenantBId, bedId: bedBId, startDate: today, endDate: end, status: "CONFIRMED" }, select: { id: true } });
    expect((await tenancyRepo.convertConfirmedBooking(source.id, today, new Date())).kind).toBe("conflict");
    const adjacent = await prisma.tenancy.create({ data: { tenantId: tenantBId, bedId: bedBId, startDate: end, endDate: later }, select: { id: true } });
    expect(adjacent.id).toBeTruthy();
    await prisma.tenancy.delete({ where: { id: adjacent.id } });
    await prisma.tenancy.delete({ where: { id: blocked.id } });
    await prisma.booking.delete({ where: { id: source.id } });
  });

  it("persists check-out and returns the ended tenancy on retry", async () => {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const end = new Date(today); end.setUTCDate(end.getUTCDate() + 2);
    const source = await prisma.booking.create({ data: { tenantId: tenantAId, bedId: bedAId, startDate: today, endDate: end, status: "CONFIRMED" }, select: { id: true } });
    const converted = await tenancyRepo.convertConfirmedBooking(source.id, today, new Date());
    expect(converted.kind).toBe("created");
    const tenancyId = (converted.tenancy as { id: string }).id;
    const first = await tenancyRepo.checkOut(tenancyId, new Date());
    const retry = await tenancyRepo.checkOut(tenancyId, new Date());
    expect(first.kind).toBe("ended");
    expect(retry.kind).toBe("already-ended");
    const stored = await prisma.tenancy.findUnique({ where: { id: tenancyId }, select: { status: true, checkedInAt: true, checkedOutAt: true } });
    expect(stored?.status).toBe("ENDED");
    expect(stored?.checkedInAt).toBeInstanceOf(Date);
    expect(stored?.checkedOutAt).toBeInstanceOf(Date);
  });
});
