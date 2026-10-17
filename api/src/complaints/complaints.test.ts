import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { hashOpaqueToken } from "../auth/service.js";
import type { AuthRepository, PublicUser } from "../auth/types.js";
import type { ComplaintRepository, ComplaintStatus, ComplaintPriority } from "./service.js";

const ids = { complaint: "76d8a2c0-5791-4ce0-a9c5-399cc0b79039", tenancy: "66d8a2c0-5791-4ce0-a9c5-399cc0b79039", room: "86d8a2c0-5791-4ce0-a9c5-399cc0b79039", bed: "96d8a2c0-5791-4ce0-a9c5-399cc0b79039" };
const csrf = "c".repeat(48);
const tenant: PublicUser = { id: "tenant-1", email: "tenant@example.test", fullName: "Tenant One", role: "TENANT" };
const owner: PublicUser = { id: "owner-1", email: "owner@example.test", fullName: "Owner One", role: "OWNER" };
const otherOwner: PublicUser = { ...owner, id: "owner-2" };
const admin: PublicUser = { ...owner, id: "admin-1", role: "ADMIN" };

function harness(user = tenant, initialStatus: ComplaintStatus = "OPEN") {
  const token = `${user.id}-${"s".repeat(40)}`;
  const activities: Array<Record<string, unknown>> = [];
  const item: Record<string, any> = { id: ids.complaint, tenantId: tenant.id, propertyId: "property-1", tenancyId: ids.tenancy, roomId: ids.room, bedId: ids.bed, title: "Leaking tap", description: "The bathroom tap has been leaking for several days.", category: "PLUMBING", priority: "NORMAL" as ComplaintPriority, status: initialStatus, resolutionNote: null, resolvedAt: null, closedAt: null, tenant: { id: tenant.id, fullName: tenant.fullName }, property: { id: "property-1", name: "Maple House", city: "Pune", region: "MH" }, room: { id: ids.room, roomNumber: "101" }, bed: { id: ids.bed, label: "A" }, activities };
  const repository: ComplaintRepository = {
    async createForTenant(tenantId, input) {
      if (tenantId !== tenant.id) return { kind: "ineligible-tenancy" };
      Object.assign(item, { title: input.title, description: input.description, category: input.category });
      activities.push({ type: "CREATED", message: "Request created.", author: { id: tenantId, fullName: tenant.fullName, role: "TENANT" } });
      return { kind: "created", complaint: item };
    },
    async listTenant(tenantId) { return tenantId === tenant.id ? [item] : []; },
    async getTenant(_id, tenantId) { return tenantId === tenant.id ? item : null; },
    async listOwner(ownerId) { return ownerId === null || ownerId === owner.id ? [item] : []; },
    async getOwner() { return item; },
    async addActivity(_id, authorId, message) { activities.push({ type: "COMMENT", message, author: { id: authorId, fullName: authorId, role: user.role } }); return item; },
    async updateOwner(_id, _authorId, input) {
      if (input.status && input.status !== item.status) {
        const transitions: Record<string, string[]> = { OPEN: ["IN_PROGRESS"], IN_PROGRESS: ["RESOLVED"], RESOLVED: ["IN_PROGRESS", "CLOSED"], CLOSED: [] };
        if (!transitions[item.status].includes(input.status)) return "invalid-transition";
        if (input.status === "RESOLVED" && !input.resolutionNote) return "resolution-required";
        activities.push({ type: "STATUS_CHANGE", fromStatus: item.status, toStatus: input.status, message: input.resolutionNote ?? input.note });
        item.status = input.status;
        if (input.status === "RESOLVED") item.resolutionNote = input.resolutionNote;
      }
      if (input.priority && input.priority !== item.priority) { activities.push({ type: "PRIORITY_CHANGE", fromPriority: item.priority, toPriority: input.priority }); item.priority = input.priority; }
      if (input.note) activities.push({ type: "COMMENT", message: input.note });
      return "updated";
    },
  };
  const auth: AuthRepository = {
    findUserByEmail: async () => null, createAccountAndSession: async () => { throw new Error("unused"); }, createSession: async () => undefined, revokeSession: async () => undefined,
    findSession: async (tokenHash) => tokenHash === hashOpaqueToken(token) ? { sessionId: "session", tokenHash, csrfTokenHash: createHash("sha256").update(csrf).digest("hex"), user } : null,
  };
  const app = createApp({ webOrigin: "http://localhost:5173", authRepository: auth, complaintRepository: repository, complaintAccess: async () => user.role === "OWNER" && user.id !== owner.id ? null : { tenantId: tenant.id, propertyOwnerId: owner.id }, passwordHasher: { hash: async (v) => v, verify: async () => false } });
  const cookies = [`pg_session=${token}`, `pg_csrf=${csrf}`].join("; ");
  return { app, item, activities, cookies, headers: { Cookie: cookies, "X-CSRF-Token": csrf } };
}

describe("Phase 4E complaint API", () => {
  it("creates and lists tenant requests, deriving tenant identity from the session", async () => {
    const h = harness();
    const created = await request(h.app).post("/api/v1/complaints").set(h.headers).send({ tenancyId: ids.tenancy, roomId: ids.room, bedId: ids.bed, title: "Leaking tap", description: "The bathroom tap has been leaking for several days.", category: "PLUMBING", tenantId: "attacker", priority: "URGENT" });
    expect(created.status).toBe(400);
    const valid = await request(h.app).post("/api/v1/complaints").set(h.headers).send({ tenancyId: ids.tenancy, title: "Leaking tap", description: "The bathroom tap has been leaking for several days.", category: "PLUMBING" });
    const listed = await request(h.app).get("/api/v1/complaints").set("Cookie", h.cookies);
    expect(valid.status).toBe(201); expect(valid.body.complaint.tenantId).toBe(tenant.id); expect(listed.status).toBe(200); expect(listed.body.complaints).toHaveLength(1);
  });
  it("hides another tenant's request and owner cross-property requests", async () => {
    const foreignTenant = harness({ ...tenant, id: "tenant-2" });
    const hidden = await request(foreignTenant.app).get(`/api/v1/complaints/${ids.complaint}`).set("Cookie", foreignTenant.cookies);
    const crossOwner = harness(otherOwner);
    const ownerHidden = await request(crossOwner.app).get(`/api/v1/owner/complaints/${ids.complaint}`).set("Cookie", crossOwner.cookies);
    expect(hidden.status).toBe(404); expect(ownerHidden.status).toBe(404);
  });
  it("requires authentication, role authorization, and CSRF for writes", async () => {
    const h = harness();
    expect((await request(h.app).get("/api/v1/complaints")).status).toBe(401);
    const noCsrf = await request(h.app).post("/api/v1/complaints").set("Cookie", h.cookies).send({ tenancyId: ids.tenancy, title: "Leaking tap", description: "The bathroom tap has been leaking for several days.", category: "PLUMBING" });
    const ownerCreate = harness(owner);
    const forbidden = await request(ownerCreate.app).post("/api/v1/complaints").set(ownerCreate.headers).send({ tenancyId: ids.tenancy, title: "Leaking tap", description: "The bathroom tap has been leaking for several days.", category: "PLUMBING" });
    expect(noCsrf.status).toBe(403); expect(forbidden.status).toBe(403);
  });
  it("validates request bodies and status transitions; records authorized priority/status audit changes", async () => {
    const bad = harness();
    const invalid = await request(bad.app).post("/api/v1/complaints").set(bad.headers).send({ tenancyId: "no", title: "x", description: "short", category: "OTHER" });
    const h = harness(owner, "IN_PROGRESS");
    const resolutionRequired = await request(h.app).patch(`/api/v1/owner/complaints/${ids.complaint}`).set(h.headers).send({ status: "RESOLVED" });
    expect(invalid.status).toBe(400); expect(resolutionRequired.status).toBe(400);
    const startHarness = harness(owner);
    const start = await request(startHarness.app).patch(`/api/v1/owner/complaints/${ids.complaint}`).set(startHarness.headers).send({ status: "IN_PROGRESS", priority: "HIGH", note: "Technician assigned." });
    expect(start.status).toBe(200); expect(startHarness.activities.map((a) => a.type)).toContain("STATUS_CHANGE"); expect(startHarness.activities.map((a) => a.type)).toContain("PRIORITY_CHANGE");
    const resolve = await request(startHarness.app).patch(`/api/v1/owner/complaints/${ids.complaint}`).set(startHarness.headers).send({ status: "RESOLVED", resolutionNote: "Tap cartridge replaced." });
    const closed = await request(startHarness.app).patch(`/api/v1/owner/complaints/${ids.complaint}`).set(startHarness.headers).send({ status: "CLOSED" });
    const invalidTerminal = await request(startHarness.app).patch(`/api/v1/owner/complaints/${ids.complaint}`).set(startHarness.headers).send({ status: "OPEN" });
    expect(resolve.status).toBe(200); expect(closed.status).toBe(200); expect(invalidTerminal.status).toBe(409);
  });
  it("allows tenant comments only on their own request", async () => {
    const h = harness();
    const added = await request(h.app).post(`/api/v1/complaints/${ids.complaint}/activities`).set(h.headers).send({ message: "The leak is getting worse." });
    expect(added.status).toBe(201); expect(h.activities.at(-1)?.type).toBe("COMMENT");
  });
});
