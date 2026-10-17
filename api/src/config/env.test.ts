import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./env.js";

describe("runtime environment validation", () => {
  it("keeps development defaults for local setup", () => {
    expect(parseEnvironment({ NODE_ENV: "development" })).toMatchObject({
      API_PORT: 4000,
      WEB_ORIGIN: "http://localhost:5173",
    });
  });

  it("requires production database and HTTPS frontend configuration without echoing secret values", () => {
    const secretValue = "postgresql://private-user:private-password@db.invalid/pg_management";

    expect(() => parseEnvironment({ NODE_ENV: "production", DATABASE_URL: secretValue }))
      .toThrow(/DATABASE_URL, WEB_ORIGIN/);
    expect(() => parseEnvironment({ NODE_ENV: "production", DATABASE_URL: secretValue }))
      .not.toThrow(secretValue);
  });

  it("rejects non-TLS PostgreSQL and non-HTTPS or non-origin production URLs", () => {
    const plainDatabase = "postgresql://user:password@db.invalid/app";
    expect(() => parseEnvironment({ NODE_ENV: "production", DATABASE_URL: plainDatabase, WEB_ORIGIN: "http://app.invalid" }))
      .toThrow(/DATABASE_URL, WEB_ORIGIN/);
    expect(() => parseEnvironment({ NODE_ENV: "production", DATABASE_URL: `${plainDatabase}?sslmode=require`, WEB_ORIGIN: "https://app.invalid/path" }))
      .toThrow(/WEB_ORIGIN/);
  });

  it("accepts explicit production PostgreSQL TLS and HTTPS origin settings", () => {
    const result = parseEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:password@db.invalid/app?sslmode=verify-full",
      WEB_ORIGIN: "https://app.invalid",
    });
    expect(result.NODE_ENV).toBe("production");
    expect(result.WEB_ORIGIN).toBe("https://app.invalid");
  });
});
