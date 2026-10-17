import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { hashOpaqueToken } from "../auth/service.js";
import type { AuthRepository, PublicUser } from "../auth/types.js";
import type { BookingMutationResult, BookingRecord, BookingRepository } from "./service.js";
import type { CreateBookingInput, OwnerBookingQuery } from "./schemas.js";

const tenant: PublicUser = { id: "tenant-1", email: "tenant@example.test", fullName: "Tenant One", role: "TENANT" };
const owner: PublicUser = { id: "owner-1", email: "owner@example.test", fullName: "Owner One", role: "OWNER" };
const bookingId = "86d8a2c0-5791-4ce0-a9c5-399cc0b79039";
const bedId = "96d8a2c0-5791-4ce0-a9c5-399cc0b79039";
const ownerToken = "o".repeat(48); const tenantToken = "t".repeat(48); const csrf = "c".repeat(48);
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const dayAfter = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const fixture: BookingRecord = { id: bookingId, tenantId: tenant.id, bedId, startDate: new Date(`${tomorrow}T00:00:00Z`), endDate: new Date(`${dayAfter}T00:00:00Z`), status: "PENDING" };

function authRepository(actingUser: PublicUser): AuthRepository {
  const csrfHash = createHash("sha256").update(csrf).digest("hex");
  return {
    findUserByEmail: async () => null,
    createAccountAndSession: async () => { throw new Error("unused"); },
    createSession: async () => undefined,
    findSession: async (tokenHash) => {
      const expectedToken = actingUser.role === "OWNER" || actingUser.role === "ADMIN" ? ownerToken : tenantToken;
      const user = tokenHash === hashOpaqueToken(expectedToken) ? actingUser : null;
      return user ? { sessionId: `session-${user.id}`, tokenHash, csrfTokenHash: csrfHash, user } : null;
    },
    revokeSession: async () => undefined,
  };
}

function memoryRepository(initial: BookingRecord = fixture): BookingRepository {
  const records = new Map([[initial.id, { ...initial }]]);
  const detail = (record: BookingRecord) => ({ ...record, tenant: { id: record.tenantId, fullName: "Tenant One", email: "tenant@example.test" }, bed: { id: record.bedId, label: "A", room: { id: "room-1", roomNumber: "1", property: { id: "property-1", name: "Test House", city: "Pune", region: "MH", ownerId: owner.id } } } });
  return {
    createPending: async (tenantId: string, input: CreateBookingInput) => ({ kind: "created", booking: { ...detail({ ...fixture, tenantId, bedId: input.bedId, startDate: new Date(`${input.startDate}T00:00:00Z`), endDate: new Date(`${input.endDate}T00:00:00Z`) }), status: "PENDING" } }),
    listTenant: async (tenantId: string) => [...records.values()].filter((item) => item.tenantId === tenantId).map(detail),
    findTenantBooking: async (id: string, tenantId: string) => { const item = records.get(id); return item?.tenantId === tenantId ? detail(item) : null; },
    listOwner: async (ownerId: string | null, query: OwnerBookingQuery) => [...records.values()].filter((item) => (!query.status || item.status === query.status) && (ownerId === null || ownerId === owner.id)).map(detail),
    findOwnerBooking: async (id: string) => { const item = records.get(id); return item ? detail(item) : null; },
    findBooking: async (id: string) => records.get(id) ?? null,
    approvePending: async (id: string, now: Date): Promise<BookingMutationResult> => { const item = records.get(id); if (!item) return "missing"; if (item.status !== "PENDING") return "invalid-transition"; if (!item.endDate || item.startDate < now) return "expired"; item.status = "CONFIRMED"; return "ok"; },
    rejectPending: async (id: string) => { const item = records.get(id); if (!item) return "missing"; if (item.status !== "PENDING") return "invalid-transition"; item.status = "REJECTED"; return "ok"; },
    cancelBooking: async (id: string, expected) => { const item = records.get(id); if (!item) return "missing"; if (item.status !== expected) return "invalid-transition"; item.status = "CANCELLED"; return "ok"; },
  };
}

function appFor(user: PublicUser = tenant, repository = memoryRepository(), accessOwnerId = owner.id) {
  return createApp({
    webOrigin: "http://localhost:5173", authRepository: authRepository(user), bookingRepository: repository,
    propertyRepository: {} as never,
    propertyAccess: { findPropertyOwnerId: async () => owner.id },
    bookingAccess: async () => ({ tenantId: tenant.id, propertyOwnerId: accessOwnerId }),
    passwordHasher: { hash: async (value) => value, verify: async () => false },
  });
}
const cookiesFor = (user: PublicUser) => `pg_session=${user.role === "OWNER" ? ownerToken : tenantToken}; pg_csrf=${csrf}`;
const writeHeaders = (user: PublicUser) => ({ Cookie: cookiesFor(user), "X-CSRF-Token": csrf });

describe("booking workflow routes", () => {
  it("creates pending requests using the session tenant and rejects client status or identity fields", async () => {
    const app = appFor();
    const response = await request(app).post("/api/v1/bookings").set(writeHeaders(tenant)).send({ bedId, startDate: tomorrow, endDate: dayAfter });
    const injected = await request(app).post("/api/v1/bookings").set(writeHeaders(tenant)).send({ bedId, startDate: tomorrow, endDate: dayAfter, tenantId: "attacker", status: "CONFIRMED" });
    expect(response.status).toBe(201);
    expect(response.body.booking.tenantId).toBe(tenant.id);
    expect(response.body.booking.status).toBe("PENDING");
    expect(injected.status).toBe(400);
  });

  it("requires a future, valid non-empty date range", async () => {
    const app = appFor();
    const past = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const invalidRange = await request(app).post("/api/v1/bookings").set(writeHeaders(tenant)).send({ bedId, startDate: tomorrow, endDate: tomorrow });
    const pastStart = await request(app).post("/api/v1/bookings").set(writeHeaders(tenant)).send({ bedId, startDate: past, endDate: today });
    expect(invalidRange.status).toBe(400);
    expect(pastStart.status).toBe(400);
  });

  it("requires tenant authentication and hides bookings from other tenants", async () => {
    const unauthenticated = await request(appFor()).get("/api/v1/bookings");
    const otherTenant: PublicUser = { ...tenant, id: "tenant-2", email: "other@example.test" };
    const hidden = await request(appFor(otherTenant)).get(`/api/v1/bookings/${bookingId}`).set("Cookie", cookiesFor(tenant));
    expect(unauthenticated.status).toBe(401);
    expect(hidden.status).toBe(404);
    const crossTenantCancel = await request(appFor(otherTenant)).post(`/api/v1/bookings/${bookingId}/cancel`).set(writeHeaders(tenant));
    expect(crossTenantCancel.status).toBe(404);
  });

  it("lists and reads only the signed-in tenant's own requests and lets owners list their properties' requests", async () => {
    const tenantList = await request(appFor()).get("/api/v1/bookings").set("Cookie", cookiesFor(tenant));
    const tenantDetail = await request(appFor()).get(`/api/v1/bookings/${bookingId}`).set("Cookie", cookiesFor(tenant));
    const ownerList = await request(appFor(owner)).get("/api/v1/owner/bookings?status=PENDING").set("Cookie", cookiesFor(owner));
    expect(tenantList.status).toBe(200);
    expect(tenantList.body.bookings).toHaveLength(1);
    expect(tenantDetail.status).toBe(200);
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.bookings).toHaveLength(1);
  });

  it("lets the property owner approve/reject pending requests but conceals cross-owner records", async () => {
    const app = appFor(owner);
    const forgedStatus = await request(app).post(`/api/v1/owner/bookings/${bookingId}/approve`).set(writeHeaders(owner)).send({ status: "REJECTED" });
    expect(forgedStatus.status).toBe(400);
    const approved = await request(app).post(`/api/v1/owner/bookings/${bookingId}/approve`).set(writeHeaders(owner));
    expect(approved.status).toBe(200);
    expect(approved.body.booking.status).toBe("CONFIRMED");
    const repeated = await request(app).post(`/api/v1/owner/bookings/${bookingId}/reject`).set(writeHeaders(owner));
    expect(repeated.status).toBe(409);
    const foreign = await request(appFor({ ...owner, id: "owner-2" }, memoryRepository(), "owner-1"))
      .post(`/api/v1/owner/bookings/${bookingId}/approve`).set(writeHeaders(owner));
    expect(foreign.status).toBe(404);
  });

  it("supports pending rejection and tenant cancellation, while making terminal states immutable", async () => {
    const repository = memoryRepository();
    const rejected = await request(appFor(owner, repository)).post(`/api/v1/owner/bookings/${bookingId}/reject`).set(writeHeaders(owner));
    expect(rejected.status).toBe(200);
    const terminalCancel = await request(appFor(tenant, repository)).post(`/api/v1/bookings/${bookingId}/cancel`).set(writeHeaders(tenant));
    expect(terminalCancel.status).toBe(409);
    const cancelled = await request(appFor()).post(`/api/v1/bookings/${bookingId}/cancel`).set(writeHeaders(tenant));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.booking.status).toBe("CANCELLED");
  });

  it("allows tenant and owner cancellation of a confirmed booking only before its start date", async () => {
    const tenantRepo = memoryRepository({ ...fixture, status: "CONFIRMED" });
    const tenantCancel = await request(appFor(tenant, tenantRepo)).post(`/api/v1/bookings/${bookingId}/cancel`).set(writeHeaders(tenant));
    expect(tenantCancel.status).toBe(200);

    const ownerRepo = memoryRepository({ ...fixture, status: "CONFIRMED" });
    const ownerCancel = await request(appFor(owner, ownerRepo)).post(`/api/v1/owner/bookings/${bookingId}/cancel`).set(writeHeaders(owner));
    expect(ownerCancel.status).toBe(200);

    const startsToday = { ...fixture, startDate: new Date(`${today}T00:00:00Z`), endDate: new Date(`${dayAfter}T00:00:00Z`), status: "CONFIRMED" as const };
    const sameDay = await request(appFor(tenant, memoryRepository(startsToday))).post(`/api/v1/bookings/${bookingId}/cancel`).set(writeHeaders(tenant));
    expect(sameDay.status).toBe(409);
  });

  it("restricts booking actions to the intended roles", async () => {
    const ownerCannotRequest = await request(appFor(owner)).post("/api/v1/bookings").set(writeHeaders(owner)).send({ bedId, startDate: tomorrow, endDate: dayAfter });
    const tenantCannotApprove = await request(appFor()).post(`/api/v1/owner/bookings/${bookingId}/approve`).set(writeHeaders(tenant));
    expect(ownerCannotRequest.status).toBe(403);
    expect(tenantCannotApprove.status).toBe(403);
  });

  it("maps bed availability conflicts to HTTP 409", async () => {
    const conflicting = memoryRepository();
    conflicting.createPending = async () => ({ kind: "conflict" });
    const response = await request(appFor(tenant, conflicting)).post("/api/v1/bookings").set(writeHeaders(tenant)).send({ bedId, startDate: tomorrow, endDate: dayAfter });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("BOOKING_CONFLICT");
  });
});
