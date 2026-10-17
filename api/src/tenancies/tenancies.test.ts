import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { hashOpaqueToken } from "../auth/service.js";
import type { AuthRepository, PublicUser } from "../auth/types.js";
import { TenancyService, type EndResult, type TenancyRepository } from "./service.js";

const tenant: PublicUser = { id: "tenant-1", email: "tenant@example.test", fullName: "Tenant", role: "TENANT" };
const owner: PublicUser = { id: "owner-1", email: "owner@example.test", fullName: "Owner", role: "OWNER" };
const otherOwner: PublicUser = { ...owner, id: "owner-2" };
const bookingId = "86d8a2c0-5791-4ce0-a9c5-399cc0b79039";
const tenancyId = "66d8a2c0-5791-4ce0-a9c5-399cc0b79039";
const token = "s".repeat(48); const csrf = "c".repeat(48);
const tenancyRecord = { id: tenancyId, bookingId, tenantId: tenant.id, bedId: "96d8a2c0-5791-4ce0-a9c5-399cc0b79039", startDate: new Date(), endDate: new Date(Date.now() + 86400000), status: "ACTIVE", checkedInAt: new Date(), checkedOutAt: null };
function authRepository(user: PublicUser): AuthRepository {
  const csrfTokenHash = createHash("sha256").update(csrf).digest("hex");
  return {
    findUserByEmail: async () => null, createAccountAndSession: async () => { throw new Error("unused"); }, createSession: async () => undefined, revokeSession: async () => undefined,
    findSession: async (tokenHash) => tokenHash === hashOpaqueToken(token) ? { sessionId: "session", tokenHash, csrfTokenHash, user } : null,
  };
}
function memoryRepository(withInitial = true): TenancyRepository {
  type MemoryTenancy = Omit<typeof tenancyRecord, "status" | "checkedOutAt"> & { status: string; checkedOutAt: Date | null };
  let current: MemoryTenancy | null = withInitial ? { ...tenancyRecord, status: "ACTIVE", checkedOutAt: null } : null;
  return {
    convertConfirmedBooking: async () => current ? { kind: "existing", tenancy: current } : (current = { ...tenancyRecord, status: "ACTIVE", checkedOutAt: null }, { kind: "created", tenancy: current }),
    listTenant: async (id) => id === tenant.id && current ? [current] : [],
    findTenant: async (id, userId) => id === tenancyId && userId === tenant.id ? current : null,
    listOwner: async (id) => id === null || id === owner.id ? current ? [current] : [] : [],
    findOwner: async (id) => id === tenancyId ? current : null,
    checkOut: async (_id, at): Promise<{ kind: EndResult; tenancy?: unknown }> => {
      if (!current) return { kind: "missing" };
      if (current.status === "ENDED") return { kind: "already-ended", tenancy: current };
      if (current.status !== "ACTIVE") return { kind: "invalid" };
      current = { ...current, status: "ENDED", checkedOutAt: at };
      return { kind: "ended", tenancy: current };
    },
  };
}
function appFor(user: PublicUser, repository = memoryRepository(), propertyOwnerId = owner.id, propertyTenantId = tenant.id) {
  return createApp({
    webOrigin: "http://localhost:5173", authRepository: authRepository(user), tenancyRepository: repository,
    tenancyAccess: async () => ({ tenantId: propertyTenantId, propertyOwnerId }),
    bookingAccess: async () => ({ tenantId: tenant.id, propertyOwnerId }),
    propertyRepository: {} as never, passwordHasher: { hash: async (value) => value, verify: async () => false },
  });
}
const cookie = `pg_session=${token}; pg_csrf=${csrf}`;
const writes = { Cookie: cookie, "X-CSRF-Token": csrf };

describe("tenancy lifecycle routes", () => {
  it("checks in from an authorized confirmed booking and makes retry idempotent", async () => {
    const repository = memoryRepository(false); const app = appFor(owner, repository);
    const first = await request(app).post(`/api/v1/owner/bookings/${bookingId}/check-in`).set(writes).send({});
    const retry = await request(app).post(`/api/v1/owner/bookings/${bookingId}/check-in`).set(writes).send({});
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(first.body.tenancy.status).toBe("ACTIVE");
    expect(retry.body.repeated).toBe(true);
  });

  it("requires authentication, role, CSRF and hides foreign tenant/owner records", async () => {
    expect((await request(appFor(tenant)).get("/api/v1/tenancies")).status).toBe(401);
    expect((await request(appFor(owner)).get("/api/v1/tenancies").set("Cookie", cookie)).status).toBe(403);
    expect((await request(appFor(owner)).post(`/api/v1/owner/tenancies/${tenancyId}/check-out`).set("Cookie", `pg_session=${token}`).send({})).status).toBe(403);
    expect((await request(appFor(otherOwner, memoryRepository(), owner.id)).get(`/api/v1/owner/tenancies/${tenancyId}`).set("Cookie", cookie)).status).toBe(404);
    expect((await request(appFor({ ...tenant, id: "tenant-2" }, memoryRepository(), owner.id, tenant.id)).get(`/api/v1/tenancies/${tenancyId}`).set("Cookie", cookie)).status).toBe(404);
  });

  it("lists only the authenticated person's records and checks out idempotently", async () => {
    const repository = memoryRepository(); const ownerApp = appFor(owner, repository); const tenantApp = appFor(tenant, repository);
    expect((await request(tenantApp).get("/api/v1/tenancies").set("Cookie", cookie)).body.tenancies).toHaveLength(1);
    const first = await request(ownerApp).post(`/api/v1/owner/tenancies/${tenancyId}/check-out`).set(writes).send({});
    const retry = await request(ownerApp).post(`/api/v1/owner/tenancies/${tenancyId}/check-out`).set(writes).send({});
    expect(first.status).toBe(200); expect(first.body.tenancy.status).toBe("ENDED");
    expect(retry.status).toBe(200); expect(retry.body.repeated).toBe(true);
  });

  it("rejects client-supplied state and malformed IDs", async () => {
    const app = appFor(owner);
    expect((await request(app).post(`/api/v1/owner/tenancies/${tenancyId}/check-out`).set(writes).send({ status: "CANCELLED" })).status).toBe(400);
    expect((await request(app).get("/api/v1/owner/tenancies/not-a-uuid").set("Cookie", cookie)).status).toBe(400);
  });
});

describe("tenancy transition rules", () => {
  it("maps early check-in, invalid booking, and invalid checkout to conflicts", async () => {
    const base = memoryRepository();
    const early = new TenancyService({ ...base, convertConfirmedBooking: async () => ({ kind: "too-early" }) }, () => new Date("2026-06-01T14:00:00Z"));
    const invalid = new TenancyService({ ...base, convertConfirmedBooking: async () => ({ kind: "invalid" }) });
    const checkout = new TenancyService({ ...base, checkOut: async () => ({ kind: "invalid" }) });
    await expect(early.checkInFromBooking(bookingId)).rejects.toMatchObject({ code: "CHECK_IN_TOO_EARLY", status: 409 });
    await expect(invalid.checkInFromBooking(bookingId)).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409 });
    await expect(checkout.checkOut(tenancyId)).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409 });
  });
});
