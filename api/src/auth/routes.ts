import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validateBody } from "../middleware/validate-body.js";
import { authenticate, requireCsrf } from "../middleware/authentication.js";
import { clearSessionCookies, setSessionCookies } from "./cookies.js";
import { loginSchema, registerSchema } from "./schemas.js";
import { AuthenticationError, createAuthService } from "./service.js";
import type { AuthRepository, PasswordHasher } from "./types.js";

interface AuthRouterOptions {
  repository: AuthRepository;
  passwords: PasswordHasher;
  loginLimit?: number;
}

export function createAuthRouter({ repository, passwords, loginLimit = 10 }: AuthRouterOptions) {
  const router = Router();
  const auth = createAuthService(repository, passwords);
  const requireAuthentication = authenticate(repository);
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again later." } },
  });

  router.post("/register", validateBody(registerSchema), async (request, response, next) => {
    try {
      const session = await auth.register(request.body);
      setSessionCookies(response, session);
      response.status(201).json({ user: session.user });
    } catch (error) {
      next(error);
    }
  });

  router.post("/login", loginRateLimiter, validateBody(loginSchema), async (request, response, next) => {
    try {
      const session = await auth.login(request.body);
      setSessionCookies(response, session);
      response.status(200).json({ user: session.user });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", requireAuthentication, (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ user: request.auth!.user });
  });

  router.post("/logout", requireAuthentication, requireCsrf, async (request, response, next) => {
    try {
      await auth.logout(request.auth!.tokenHash);
      clearSessionCookies(response);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
