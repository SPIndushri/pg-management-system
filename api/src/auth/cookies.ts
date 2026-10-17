import type { Response } from "express";
import { env } from "../config/env.js";
import type { IssuedSession } from "./service.js";

export const SESSION_COOKIE = "pg_session";
export const CSRF_COOKIE = "pg_csrf";

const production = env.NODE_ENV === "production";
const baseCookieOptions = {
  secure: production,
  sameSite: "lax" as const,
  path: "/",
};

export function setSessionCookies(response: Response, session: IssuedSession): void {
  response.cookie(SESSION_COOKIE, session.token, {
    ...baseCookieOptions,
    httpOnly: true,
    expires: session.expiresAt,
  });
  response.cookie(CSRF_COOKIE, session.csrfToken, {
    ...baseCookieOptions,
    httpOnly: false,
    expires: session.expiresAt,
  });
}

export function clearSessionCookies(response: Response): void {
  response.clearCookie(SESSION_COOKIE, { ...baseCookieOptions, httpOnly: true });
  response.clearCookie(CSRF_COOKIE, { ...baseCookieOptions, httpOnly: false });
}
