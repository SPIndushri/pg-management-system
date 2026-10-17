import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { AuthRepository } from "../auth/types.js";
import { authenticate, requireRole } from "../middleware/authentication.js";
import { DashboardService } from "./service.js";
import { dashboardQuerySchema } from "./schemas.js";

type Query = z.infer<typeof dashboardQuerySchema>;
const validateQuery: RequestHandler = (req, _res, next) => {
  const parsed = dashboardQuerySchema.safeParse(req.query);
  if (!parsed.success) { next(parsed.error); return; }
  Object.assign(req, { dashboardQuery: parsed.data }); next();
};
export function createDashboardRouter(service: DashboardService, auth: AuthRepository) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/dashboard", authenticate(auth), requireRole("OWNER", "ADMIN", "TENANT"), validateQuery, async (req, res, next) => {
    const query = (req as typeof req & { dashboardQuery: Query }).dashboardQuery;
    try {
      if (req.auth!.user.role === "TENANT") res.json({ role: "TENANT", dashboard: await service.tenant(req.auth!.user.id, query) });
      else res.json({ role: req.auth!.user.role, dashboard: await service.owner(req.auth!.user.role === "ADMIN" ? null : req.auth!.user.id, query) });
    } catch (error) { next(error); }
  });
  return router;
}
