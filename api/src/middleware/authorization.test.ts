import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requireRole } from "./authentication.js";
import { authorizePropertyOwner, authorizeTenantRecord } from "./resource-authorization.js";
import type { PublicUser } from "../auth/types.js";

function protectedApp(user: PublicUser, ...middleware: express.RequestHandler[]) {
  const app = express();
  app.get("/resource/:recordId", (request, _response, next) => {
    request.auth = {
      sessionId: "session-id",
      tokenHash: "a".repeat(64),
      csrfTokenHash: "b".repeat(64),
      user,
    };
    next();
  }, ...middleware, (_request, response) => response.status(200).json({ allowed: true }));
  return app;
}

describe("authorization middleware", () => {
  it("enforces allowed roles", async () => {
    const tenant: PublicUser = { id: "tenant-id", email: "t@example.com", fullName: "Tenant", role: "TENANT" };
    const owner: PublicUser = { ...tenant, id: "owner-id", role: "OWNER" };
    const tenantResponse = await request(protectedApp(tenant, requireRole("OWNER"))).get("/resource/probe");
    const ownerResponse = await request(protectedApp(owner, requireRole("OWNER"))).get("/resource/probe");

    expect(tenantResponse.status).toBe(403);
    expect(ownerResponse.status).toBe(200);
  });

  it("scopes property access to the authenticated owner", async () => {
    const owner: PublicUser = { id: "owner-1", email: "o@example.com", fullName: "Owner", role: "OWNER" };
    const repository = { findPropertyOwnerId: async () => "owner-1" };
    const allowed = await request(protectedApp(owner, authorizePropertyOwner(repository, "recordId"))).get("/resource/property-1");
    const foreignOwner = { ...owner, id: "owner-2" };
    const denied = await request(protectedApp(foreignOwner, authorizePropertyOwner(repository, "recordId"))).get("/resource/property-1");

    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(404);
  });

  it("scopes tenant records to their tenant and conceals foreign record IDs", async () => {
    const tenant: PublicUser = { id: "tenant-1", email: "t@example.com", fullName: "Tenant", role: "TENANT" };
    const lookup = async (recordId: string) => recordId === "missing-record"
      ? null
      : { tenantId: recordId === "own-record" ? "tenant-1" : "tenant-2", propertyOwnerId: "owner-1" };
    const allowed = await request(protectedApp(tenant, authorizeTenantRecord(lookup))).get("/resource/own-record");
    const denied = await request(protectedApp(tenant, authorizeTenantRecord(lookup))).get("/resource/foreign-record");
    const owner: PublicUser = { id: "owner-1", email: "o@example.com", fullName: "Owner", role: "OWNER" };
    const ownerAllowed = await request(protectedApp(owner, authorizeTenantRecord(lookup))).get("/resource/foreign-record");
    const ownerDenied = await request(protectedApp({ ...owner, id: "owner-2" }, authorizeTenantRecord(lookup))).get("/resource/foreign-record");

    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(404);
    expect(denied.body.error).toEqual({ code: "NOT_FOUND", message: "Resource not found." });
    expect(ownerAllowed.status).toBe(200);
    expect(ownerDenied.status).toBe(404);
  });
});
