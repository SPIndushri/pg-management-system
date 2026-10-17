import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { hashOpaqueToken } from "../auth/service.js";
import type { AuthRepository, PublicUser } from "../auth/types.js";
import type { DashboardRepository } from "./service.js";

const csrf = "d".repeat(48);
function setup(user: PublicUser) {
  const token = `${user.id}-${"a".repeat(40)}`;
  const calls: Array<{ role: "owner" | "tenant"; id: string | null; range: { from: Date; toExclusive: Date; asOf: Date } }> = [];
  const auth: AuthRepository = {
    findUserByEmail: async () => null, createAccountAndSession: async () => { throw new Error("unused"); }, createSession: async () => undefined, revokeSession: async () => undefined,
    findSession: async (tokenHash) => tokenHash === hashOpaqueToken(token) ? { sessionId: "session", tokenHash, csrfTokenHash: createHash("sha256").update(csrf).digest("hex"), user } : null,
  };
  const dashboard: DashboardRepository = {
    owner: async (id, range) => { calls.push({ role: "owner", id, range }); return { privateOwnerMetrics: id }; },
    tenant: async (id, range) => { calls.push({ role: "tenant", id, range }); return { privateTenantMetrics: id }; },
  };
  return { app: createApp({ webOrigin: "http://localhost:5173", authRepository: auth, dashboardRepository: dashboard, passwordHasher: { hash: async (v) => v, verify: async () => false } }), cookie: `pg_session=${token}`, calls };
}
const owner: PublicUser = { id: "owner-17", email: "owner@example.test", fullName: "Owner", role: "OWNER" };

describe("role-aware dashboard API", () => {
  it("requires authentication and rejects invalid date ranges", async () => {
    const ownerSetup = setup(owner);
    expect((await request(ownerSetup.app).get("/api/v1/dashboard")).status).toBe(401);
    expect((await request(ownerSetup.app).get("/api/v1/dashboard?from=2026-11-10&to=2026-11-01").set("Cookie", ownerSetup.cookie)).status).toBe(400);
    expect((await request(ownerSetup.app).get("/api/v1/dashboard?from=2099-11-01").set("Cookie", ownerSetup.cookie)).status).toBe(400);
    expect(ownerSetup.calls).toHaveLength(0);
  });
  it("scopes owner summaries to the authenticated owner and passes validated dates", async () => {
    const h = setup(owner);
    const to = new Date(); to.setUTCHours(0, 0, 0, 0);
    const from = new Date(to); from.setUTCDate(from.getUTCDate() - 9);
    const fromText = from.toISOString().slice(0, 10); const toText = to.toISOString().slice(0, 10);
    const response = await request(h.app).get(`/api/v1/dashboard?from=${fromText}&to=${toText}`).set("Cookie", h.cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ role: "OWNER", dashboard: { privateOwnerMetrics: owner.id } });
    expect(h.calls[0]?.id).toBe(owner.id);
    expect(h.calls[0]?.range.from.toISOString()).toBe(`${fromText}T00:00:00.000Z`);
    const nextDay = new Date(to); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    expect(new Date(h.calls[0]!.range.toExclusive).toISOString()).toBe(nextDay.toISOString());
  });
  it("uses only tenant-scoped results and gives admins the all-property owner policy", async () => {
    const tenant = setup({ id: "tenant-8", email: "tenant@example.test", fullName: "Tenant", role: "TENANT" });
    const tenantResponse = await request(tenant.app).get("/api/v1/dashboard").set("Cookie", tenant.cookie);
    expect(tenantResponse.status).toBe(200); expect(tenantResponse.body.dashboard).toEqual({ privateTenantMetrics: "tenant-8" });
    expect(tenant.calls.map((call) => call.role)).toEqual(["tenant"]);

    const admin = setup({ ...owner, id: "admin-1", role: "ADMIN" });
    const adminResponse = await request(admin.app).get("/api/v1/dashboard").set("Cookie", admin.cookie);
    expect(adminResponse.status).toBe(200); expect(adminResponse.body.role).toBe("ADMIN");
    expect(admin.calls[0]).toMatchObject({ role: "owner", id: null });
  });
});
