import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { hashOpaqueToken } from "../auth/service.js";
import type { AuthRepository, PublicUser } from "../auth/types.js";
import type { PropertyRepository } from "./service.js";
import { isBedAvailable } from "./availability.js";

const propertyId = "66d8a2c0-5791-4ce0-a9c5-399cc0b79039";
const sessionCookie = "s".repeat(48);
const csrfCookie = "c".repeat(48);
const owner: PublicUser = { id: "owner-1", email: "owner@example.test", fullName: "Owner", role: "OWNER" };
function authRepo(user: PublicUser): AuthRepository {
  return {
    findUserByEmail: async () => null,
    createAccountAndSession: async () => { throw new Error("unused"); },
    createSession: async () => undefined,
    findSession: async (tokenHash) => tokenHash === hashOpaqueToken(sessionCookie) ? { sessionId: "session", tokenHash, csrfTokenHash: createHash("sha256").update(csrfCookie).digest("hex"), user } : null,
    revokeSession: async () => undefined,
  };
}
function testApp(user = owner, repository?: Partial<PropertyRepository>) {
  const properties: Partial<PropertyRepository> = {
    listManaged: async () => [], createProperty: async (ownerId, input) => ({ id: propertyId, ownerId, ...input }),
    getManaged: async () => ({ id: propertyId }), updateProperty: async () => ({ id: propertyId }), deleteProperty: async () => "deleted",
    listRooms: async () => [], createRoom: async () => ({ id: "room" }), updateRoom: async () => ({ id: "room" }), deleteRoom: async () => "deleted",
    listBeds: async () => [], createBed: async () => ({ id: "bed" }), updateBed: async () => ({ id: "bed" }), deleteBed: async () => "deleted",
    browse: async (query) => ({ items: [{ id: propertyId, name: "Visible", rooms: [{ beds: [{ id: "bed-1", label: "A", isAvailable: true }] }] }], page: query.page, pageSize: query.pageSize, total: 1, totalPages: 1 }),
    publicDetail: async () => ({ id: propertyId, name: "Visible", rooms: [{ beds: [{ id: "bed-1", label: "A", isAvailable: true }] }] }),
    ...repository,
  };
  return createApp({ webOrigin: "http://localhost:5173", authRepository: authRepo(user), propertyRepository: properties as PropertyRepository, propertyAccess: { findPropertyOwnerId: async (id) => id === propertyId ? owner.id : null }, passwordHasher: { hash: async (v) => v, verify: async () => false } });
}
const cookies = [`pg_session=${sessionCookie}`, `pg_csrf=${csrfCookie}`];
const mutationHeaders = { Cookie: cookies.join("; "), "X-CSRF-Token": csrfCookie };

describe("Phase 4A property endpoints", () => {
  it("allows an owner to create properties with their session identity, not a client ownerId", async () => {
    const response = await request(testApp()).post("/api/v1/owner/properties").set(mutationHeaders).send({ name: "Maple House", addressLine1: "12 Main Road", city: "Pune", region: "MH", postalCode: "411001", countryCode: "in", ownerId: "attacker" });
    expect(response.status).toBe(400);
    const valid = await request(testApp()).post("/api/v1/owner/properties").set(mutationHeaders).send({ name: "Maple House", addressLine1: "12 Main Road", city: "Pune", region: "MH", postalCode: "411001", countryCode: "in" });
    expect(valid.status).toBe(201);
    expect(valid.body.property.ownerId).toBe(owner.id);
  });
  it("requires authentication and conceals properties owned by someone else", async () => {
    const unauthenticated = await request(testApp()).get(`/api/v1/owner/properties/${propertyId}`);
    const foreign = await request(testApp({ ...owner, id: "owner-2" })).get(`/api/v1/owner/properties/${propertyId}`).set("Cookie", cookies.join("; "));
    expect(unauthenticated.status).toBe(401);
    expect(foreign.status).toBe(404);
  });
  it("prevents admin property creation and returns only the safe public shape", async () => {
    const admin = { ...owner, role: "ADMIN" as const };
    const denied = await request(testApp(admin)).post("/api/v1/owner/properties").set(mutationHeaders).send({ name: "Bad", addressLine1: "1", city: "x", region: "x", postalCode: "1", countryCode: "US" });
    const publicResponse = await request(testApp()).get("/api/v1/properties?page=1&pageSize=5");
    expect(denied.status).toBe(403);
    expect(publicResponse.status).toBe(200);
    expect(JSON.stringify(publicResponse.body)).not.toContain("tenantId");
    expect(JSON.stringify(publicResponse.body)).not.toContain("booking");
    expect(publicResponse.body.items[0].rooms[0].beds[0].isAvailable).toBe(true);
  });
  it("validates browse pagination and serves public details", async () => {
    const invalid = await request(testApp()).get("/api/v1/properties?page=0");
    const detail = await request(testApp()).get(`/api/v1/properties/${propertyId}`);
    expect(invalid.status).toBe(400);
    expect(detail.status).toBe(200);
  });
  it("supports room and bed management and rejects malformed identifiers", async () => {
    const app = testApp();
    const room = await request(app).post(`/api/v1/owner/properties/${propertyId}/rooms`).set(mutationHeaders).send({ roomNumber: "101", floor: 1 });
    const bed = await request(app).post(`/api/v1/owner/properties/${propertyId}/rooms/${"66d8a2c0-5791-4ce0-a9c5-399cc0b79039"}/beds`).set(mutationHeaders).send({ label: "A" });
    const malformed = await request(app).get("/api/v1/properties/not-a-uuid");
    expect(room.status).toBe(201);
    expect(bed.status).toBe(201);
    expect(malformed.status).toBe(400);
  });
  it("supports update and delete operations across property, room and bed resources", async () => {
    const app = testApp();
    const roomId = "66d8a2c0-5791-4ce0-a9c5-399cc0b79039";
    const bedId = "76d8a2c0-5791-4ce0-a9c5-399cc0b79039";
    const property = await request(app).patch(`/api/v1/owner/properties/${propertyId}`).set(mutationHeaders).send({ name: "Updated" });
    const room = await request(app).patch(`/api/v1/owner/properties/${propertyId}/rooms/${roomId}`).set(mutationHeaders).send({ roomNumber: "201" });
    const bed = await request(app).patch(`/api/v1/owner/properties/${propertyId}/rooms/${roomId}/beds/${bedId}`).set(mutationHeaders).send({ label: "B", status: "MAINTENANCE" });
    const removedBed = await request(app).delete(`/api/v1/owner/properties/${propertyId}/rooms/${roomId}/beds/${bedId}`).set(mutationHeaders);
    const removedRoom = await request(app).delete(`/api/v1/owner/properties/${propertyId}/rooms/${roomId}`).set(mutationHeaders);
    const removedProperty = await request(app).delete(`/api/v1/owner/properties/${propertyId}`).set(mutationHeaders);
    expect(property.status).toBe(200);
    expect(room.status).toBe(200);
    expect(bed.status).toBe(200);
    expect(removedBed.status).toBe(204);
    expect(removedRoom.status).toBe(204);
    expect(removedProperty.status).toBe(204);
  });
  it("computes availability from bed status and overlapping confirmed booking/active tenancy periods", () => {
    const start = new Date("2026-10-20T00:00:00Z");
    const end = new Date("2026-10-23T00:00:00Z");
    const booking = { status: "CONFIRMED", startDate: new Date("2026-10-22T00:00:00Z"), endDate: new Date("2026-10-25T00:00:00Z") };
    const tenancy = { status: "ACTIVE", startDate: new Date("2026-10-01T00:00:00Z"), endDate: null };
    expect(isBedAvailable("AVAILABLE", [], [], start, end)).toBe(true);
    expect(isBedAvailable("AVAILABLE", [booking], [], start, end)).toBe(false);
    expect(isBedAvailable("AVAILABLE", [], [tenancy], start, end)).toBe(false);
    expect(isBedAvailable("MAINTENANCE", [], [], start, end)).toBe(false);
    expect(isBedAvailable("AVAILABLE", [{ ...booking, status: "CANCELLED" }], [], start, end)).toBe(true);
  });
});
