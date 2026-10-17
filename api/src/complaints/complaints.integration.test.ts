import "../config/env.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../services/prisma.js";
import { createPrismaComplaintRepository } from "./prisma-repository.js";

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const repository = createPrismaComplaintRepository(prisma);
describe.skipIf(!runIntegration)("PostgreSQL complaint integration", () => {
  const suffix = randomUUID();
  let ownerId = ""; let tenantId = ""; let propertyId = ""; let roomId = ""; let bedId = ""; let tenancyId = "";
  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: `complaint-owner-${suffix}@example.invalid`, fullName: "Complaint owner", passwordHash: "unused-integration-hash", role: "OWNER" }, select: { id: true } })).id;
    tenantId = (await prisma.user.create({ data: { email: `complaint-tenant-${suffix}@example.invalid`, fullName: "Complaint tenant", passwordHash: "unused-integration-hash", role: "TENANT" }, select: { id: true } })).id;
    propertyId = (await prisma.property.create({ data: { ownerId, name: `Complaint integration ${suffix}`, addressLine1: "Integration test", city: "Test", region: "Test", postalCode: "00000", countryCode: "ZZ" }, select: { id: true } })).id;
    roomId = (await prisma.room.create({ data: { propertyId, roomNumber: "IT-C" }, select: { id: true } })).id;
    bedId = (await prisma.bed.create({ data: { roomId, label: "A" }, select: { id: true } })).id;
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tenancyId = (await prisma.tenancy.create({ data: { tenantId, bedId, startDate: today, endDate: tomorrow }, select: { id: true } })).id;
  });
  afterAll(async () => {
    if (propertyId) {
      await prisma.complaintActivity.deleteMany({ where: { complaint: { propertyId } } });
      await prisma.complaint.deleteMany({ where: { propertyId } });
    }
    if (tenancyId) await prisma.tenancy.deleteMany({ where: { id: tenancyId } });
    if (bedId) await prisma.bed.deleteMany({ where: { id: bedId } });
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    if (propertyId) await prisma.property.deleteMany({ where: { id: propertyId } });
    const userIds = [ownerId, tenantId].filter(Boolean);
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  it("accepts only a tenant's current active stay and persists category, location and creator audit event", async () => {
    const input = { tenancyId, roomId, bedId, title: "Tap leak", description: "The bathroom tap leaks when turned off.", category: "PLUMBING" as const };
    const created = await repository.createForTenant(tenantId, input, new Date());
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const record = created.complaint as { id: string; category: string; propertyId: string; roomId: string; bedId: string; activities: Array<{ type: string }> };
    expect(record.category).toBe("PLUMBING"); expect(record.propertyId).toBe(propertyId); expect(record.roomId).toBe(roomId); expect(record.bedId).toBe(bedId); expect(record.activities[0]?.type).toBe("CREATED");
    expect((await repository.createForTenant(randomUUID(), input, new Date())).kind).toBe("ineligible-tenancy");
  });
});
