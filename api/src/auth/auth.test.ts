import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Response as SupertestResponse } from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { argon2PasswordHasher } from "./password.js";
import { hashOpaqueToken } from "./service.js";
import type { AuthRepository, AuthUserRecord, AuthenticatedSession, NewSession, PublicUser } from "./types.js";

const webOrigin = "http://localhost:5173";

class InMemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUserRecord>();
  readonly sessions = new Map<string, NewSession & { id: string; revokedAt: Date | null }>();

  async findUserByEmail(email: string) {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }

  async createAccountAndSession(input: {
    email: string;
    fullName: string;
    passwordHash: string;
    session: Omit<NewSession, "userId">;
  }) {
    if (await this.findUserByEmail(input.email)) throw { code: "P2002" };
    const user: AuthUserRecord = {
      id: randomUUID(),
      email: input.email,
      fullName: input.fullName,
      passwordHash: input.passwordHash,
      role: "TENANT",
    };
    this.users.set(user.id, user);
    this.addSession({ ...input.session, userId: user.id });
    return user;
  }

  async createSession(input: NewSession) {
    this.addSession(input);
  }

  async findSession(tokenHash: string, now: Date): Promise<AuthenticatedSession | null> {
    const session = this.sessions.get(tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    const user = this.users.get(session.userId);
    if (!user) return null;
    return {
      sessionId: session.id,
      tokenHash,
      csrfTokenHash: session.csrfTokenHash,
      user: publicUser(user),
    };
  }

  async revokeSession(tokenHash: string, revokedAt: Date) {
    const session = this.sessions.get(tokenHash);
    if (session) session.revokedAt = revokedAt;
  }

  private addSession(input: NewSession) {
    this.sessions.set(input.tokenHash, { ...input, id: randomUUID(), revokedAt: null });
  }
}

function publicUser(user: AuthUserRecord): PublicUser {
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}

function sessionCookies(response: SupertestResponse): string {
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : [];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

describe("authentication API", () => {
  let repository: InMemoryAuthRepository;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    repository = new InMemoryAuthRepository();
    app = createApp({ authRepository: repository, passwordHasher: argon2PasswordHasher, webOrigin });
  });

  it("registers a normalized tenant account and issues secure session cookies", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", webOrigin)
      .send({ email: "  New.User@Example.com ", fullName: "New User", password: "a-secure-password-123" });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ email: "new.user@example.com", role: "TENANT" });
    expect(response.body.user).not.toHaveProperty("passwordHash");
    expect(response.body.user).not.toHaveProperty("password");
    expect(repository.users.size).toBe(1);
    expect(repository.users.values().next().value?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(response.headers["set-cookie"]).toEqual(expect.arrayContaining([
      expect.stringMatching(/pg_session=.*HttpOnly.*SameSite=Lax/i),
      expect.stringMatching(/pg_csrf=.*SameSite=Lax/i),
    ]));
  });

  it("logs in with the normalized email and returns no password material", async () => {
    await registerAccount(app);
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", webOrigin)
      .send({ email: "TENANT@example.com", password: "a-secure-password-123" });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe("tenant@example.com");
    expect(response.body.user).not.toHaveProperty("passwordHash");
  });

  it("returns the same generic error for unknown email and wrong password", async () => {
    await registerAccount(app);
    const known = await request(app).post("/api/v1/auth/login").set("Origin", webOrigin)
      .send({ email: "tenant@example.com", password: "wrong-password" });
    const unknown = await request(app).post("/api/v1/auth/login").set("Origin", webOrigin)
      .send({ email: "missing@example.com", password: "wrong-password" });

    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.error.message).toBe("Invalid email or password.");
  });

  it("rejects duplicate registration without disclosing the account state", async () => {
    await registerAccount(app);
    const response = await request(app).post("/api/v1/auth/register").set("Origin", webOrigin)
      .send({ email: "TENANT@example.com", fullName: "Other", password: "a-secure-password-123" });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: "REGISTRATION_UNAVAILABLE",
      message: "Unable to register with those details.",
    });
  });

  it("rejects public role assignment, invalid bodies, and untrusted browser origins", async () => {
    const admin = await request(app).post("/api/v1/auth/register").set("Origin", webOrigin)
      .send({ email: "admin@example.com", fullName: "Admin", password: "a-secure-password-123", role: "ADMIN" });
    const invalid = await request(app).post("/api/v1/auth/register").set("Origin", webOrigin)
      .send({ email: "not-an-email", fullName: "", password: "short" });
    const foreignOrigin = await request(app).post("/api/v1/auth/register").set("Origin", "https://attacker.invalid")
      .send({ email: "tenant@example.com", fullName: "Tenant", password: "a-secure-password-123" });

    expect(admin.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    expect(foreignOrigin.status).toBe(403);
    expect(repository.users.size).toBe(0);
  });

  it("requires authentication, supports current-user lookup, and revokes sessions on CSRF-protected logout", async () => {
    const unauthorized = await request(app).get("/api/v1/auth/me");
    expect(unauthorized.status).toBe(401);

    const registered = await registerAccount(app);
    const cookies = sessionCookies(registered);
    const current = await request(app).get("/api/v1/auth/me").set("Cookie", cookies);
    expect(current.status).toBe(200);
    expect(current.body.user.email).toBe("tenant@example.com");

    const rejectedLogout = await request(app).post("/api/v1/auth/logout").set("Origin", webOrigin)
      .set("Cookie", cookies).set("X-CSRF-Token", "wrong-token");
    expect(rejectedLogout.status).toBe(403);

    const csrf = cookies.match(/pg_csrf=([^;]+)/)?.[1];
    expect(csrf).toBeTruthy();
    const logout = await request(app).post("/api/v1/auth/logout").set("Origin", webOrigin)
      .set("Cookie", cookies).set("X-CSRF-Token", csrf!);
    expect(logout.status).toBe(204);

    const afterLogout = await request(app).get("/api/v1/auth/me").set("Cookie", cookies);
    expect(afterLogout.status).toBe(401);
  });

  it("rejects an expired session even when the cookie is still presented", async () => {
    const registered = await registerAccount(app);
    const cookies = sessionCookies(registered);
    const token = cookies.match(/pg_session=([^;]+)/)?.[1];
    expect(token).toBeTruthy();
    const session = repository.sessions.get(hashOpaqueToken(token!));
    expect(session).toBeTruthy();
    session!.expiresAt = new Date(Date.now() - 1_000);

    const response = await request(app).get("/api/v1/auth/me").set("Cookie", cookies);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rate limits repeated login attempts", async () => {
    app = createApp({ authRepository: repository, passwordHasher: argon2PasswordHasher, webOrigin, loginLimit: 1 });
    const credentials = { email: "unknown@example.com", password: "wrong-password" };
    const first = await request(app).post("/api/v1/auth/login").set("Origin", webOrigin).send(credentials);
    const second = await request(app).post("/api/v1/auth/login").set("Origin", webOrigin).send(credentials);

    expect(first.status).toBe(401);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("RATE_LIMITED");
  });
});

async function registerAccount(app: ReturnType<typeof createApp>) {
  return request(app).post("/api/v1/auth/register").set("Origin", webOrigin)
    .send({ email: "Tenant@Example.com", fullName: "Test Tenant", password: "a-secure-password-123" });
}
