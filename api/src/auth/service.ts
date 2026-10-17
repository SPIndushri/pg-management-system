import { createHash, randomBytes } from "node:crypto";
import type { AuthRepository, AuthUserRecord, NewSession, PasswordHasher, PublicUser } from "./types.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class AuthenticationError extends Error {
  constructor(
    readonly code: "INVALID_CREDENTIALS" | "REGISTRATION_UNAVAILABLE",
    readonly status: 400 | 401,
    message: string,
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export interface IssuedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  user: PublicUser;
}

export function createAuthService(
  repository: AuthRepository,
  passwords: PasswordHasher,
  now: () => Date = () => new Date(),
) {
  return {
    async register(input: { email: string; fullName: string; password: string }): Promise<IssuedSession> {
      const email = normalizeEmail(input.email);
      const tokens = createTokens();
      const session = createNewSession(tokens, now());
      const passwordHash = await passwords.hash(input.password);

      try {
        const user = await repository.createAccountAndSession({
          email,
          fullName: input.fullName.trim(),
          passwordHash,
          session,
        });
        return issue(tokens, session.expiresAt, user);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AuthenticationError(
            "REGISTRATION_UNAVAILABLE",
            400,
            "Unable to register with those details.",
          );
        }
        throw error;
      }
    },

    async login(input: { email: string; password: string }): Promise<IssuedSession> {
      const user = await repository.findUserByEmail(normalizeEmail(input.email));
      let passwordMatches = false;
      if (user) {
        try {
          passwordMatches = await passwords.verify(user.passwordHash, input.password);
        } catch {
          passwordMatches = false;
        }
      } else {
        // Spend comparable password-hashing work for unknown accounts to reduce timing leaks.
        await passwords.hash(input.password);
      }

      if (!user || !passwordMatches) {
        throw new AuthenticationError("INVALID_CREDENTIALS", 401, "Invalid email or password.");
      }

      const tokens = createTokens();
      const session = { ...createNewSession(tokens, now()), userId: user.id };
      await repository.createSession(session);
      return issue(tokens, session.expiresAt, user);
    },

    async logout(tokenHash: string): Promise<void> {
      await repository.revokeSession(tokenHash, now());
    },
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createTokens() {
  return {
    token: randomBytes(32).toString("base64url"),
    csrfToken: randomBytes(32).toString("base64url"),
  };
}

function createNewSession(tokens: { token: string; csrfToken: string }, createdAt: Date):
  Omit<NewSession, "userId"> {
  return {
    tokenHash: hashOpaqueToken(tokens.token),
    csrfTokenHash: hashOpaqueToken(tokens.csrfToken),
    expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS),
  };
}

function issue(tokens: { token: string; csrfToken: string }, expiresAt: Date, user: AuthUserRecord): IssuedSession {
  return {
    token: tokens.token,
    csrfToken: tokens.csrfToken,
    expiresAt,
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
