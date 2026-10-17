export type UserRole = "ADMIN" | "OWNER" | "TENANT";

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export interface AuthUserRecord extends PublicUser {
  passwordHash: string;
}

export interface AuthenticatedSession {
  sessionId: string;
  tokenHash: string;
  csrfTokenHash: string;
  user: PublicUser;
}

export interface NewSession {
  userId: string;
  tokenHash: string;
  csrfTokenHash: string;
  expiresAt: Date;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  createAccountAndSession(input: {
    email: string;
    fullName: string;
    passwordHash: string;
    session: Omit<NewSession, "userId">;
  }): Promise<AuthUserRecord>;
  createSession(input: NewSession): Promise<void>;
  findSession(tokenHash: string, now: Date): Promise<AuthenticatedSession | null>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}
