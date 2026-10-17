import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, createApp } from "./app.js";

describe("health endpoint", () => {
  it("returns API process health", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("reports database readiness without exposing database errors", async () => {
    const readyApp = createApp({ databaseCheck: async () => undefined });
    const ready = await request(readyApp).get("/api/v1/health/ready");
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: "ready" });

    const unavailableApp = createApp({ databaseCheck: async () => { throw new Error("connection URL contains private-password"); } });
    const unavailable = await request(unavailableApp).get("/api/v1/health/ready");
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toEqual({ status: "not_ready" });
    expect(JSON.stringify(unavailable.body)).not.toContain("private-password");
  });
});
