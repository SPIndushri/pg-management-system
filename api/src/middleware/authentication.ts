import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { CSRF_COOKIE, SESSION_COOKIE } from "../auth/cookies.js";
import { hashOpaqueToken } from "../auth/service.js";
import type { AuthRepository } from "../auth/types.js";

declare global {
  namespace Express {
    interface Request {
      auth?: import("../auth/types.js").AuthenticatedSession;
    }
  }
}

export function authenticate(repository: AuthRepository, now: () => Date = () => new Date()): RequestHandler {
  return async (request, response, next) => {
    const token = request.cookies?.[SESSION_COOKIE];
    if (typeof token !== "string" || token.length < 32) {
      response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } });
      return;
    }

    try {
      const session = await repository.findSession(hashOpaqueToken(token), now());
      if (!session) {
        response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } });
        return;
      }
      request.auth = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(...allowedRoles: import("../auth/types.js").UserRole[]): RequestHandler {
  return (request, response, next) => {
    if (!request.auth) {
      response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } });
      return;
    }
    if (!allowedRoles.includes(request.auth.user.role)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "You are not allowed to access this resource." } });
      return;
    }
    next();
  };
}

export const requireCsrf: RequestHandler = (request, response, next) => {
  const cookieToken = request.cookies?.[CSRF_COOKIE];
  const headerToken = request.get("x-csrf-token");
  const expectedHash = request.auth?.csrfTokenHash;

  if (!expectedHash || !constantTimeEqual(cookieToken, headerToken) || !constantTimeEqual(hashOpaqueTokenOrEmpty(cookieToken), expectedHash)) {
    response.status(403).json({ error: { code: "CSRF_INVALID", message: "Request verification failed." } });
    return;
  }
  next();
};

function hashOpaqueTokenOrEmpty(token: unknown): string {
  return typeof token === "string" ? hashOpaqueToken(token) : "";
}

function constantTimeEqual(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
