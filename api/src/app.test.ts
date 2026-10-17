import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./app.js";

describe("health endpoint", () => {
  it("returns API process health", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
