import type { PrismaClient } from "@prisma/client";
import type { AuthRepository, AuthUserRecord, NewSession, PublicUser } from "./types.js";

const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
} as const;

export function createPrismaAuthRepository(prisma: PrismaClient): AuthRepository {
  return {
    async findUserByEmail(email) {
      const user = await prisma.user.findUnique({ where: { email } });
      return user ? toAuthUser(user) : null;
    },

    async createAccountAndSession({ email, fullName, passwordHash, session }) {
      return prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { email, fullName, passwordHash, role: "TENANT" },
        });
        await transaction.authSession.create({
          data: {
            userId: user.id,
            tokenHash: session.tokenHash,
            csrfTokenHash: session.csrfTokenHash,
            expiresAt: session.expiresAt,
          },
        });
        return toAuthUser(user);
      });
    },

    async createSession(session) {
      await prisma.authSession.create({ data: session });
    },

    async findSession(tokenHash, now) {
      const session = await prisma.authSession.findFirst({
        where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
        include: { user: { select: publicUserSelect } },
      });
      if (!session) return null;
      return {
        sessionId: session.id,
        tokenHash: session.tokenHash,
        csrfTokenHash: session.csrfTokenHash,
        user: session.user as PublicUser,
      };
    },

    async revokeSession(tokenHash, revokedAt) {
      await prisma.authSession.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt },
      });
    },
  };
}

function toAuthUser(user: {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  role: "ADMIN" | "OWNER" | "TENANT";
}): AuthUserRecord {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    passwordHash: user.passwordHash,
    role: user.role,
  };
}
