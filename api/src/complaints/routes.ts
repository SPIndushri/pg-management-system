import { Router, type Request, type RequestHandler } from "express";
import type { AuthRepository } from "../auth/types.js";
import { authenticate, requireCsrf, requireRole } from "../middleware/authentication.js";
import { authorizeTenantRecord, type TenantRecordAccess } from "../middleware/resource-authorization.js";
import { validateBody } from "../middleware/validate-body.js";
import { ComplaintService } from "./service.js";
import { activitySchema, complaintIdSchema, createComplaintSchema, ownerListQuerySchema, tenantListQuerySchema, updateComplaintSchema } from "./schemas.js";
import { z } from "zod";

type Query = z.infer<typeof ownerListQuerySchema>;
const validateId: RequestHandler = (req, _res, next) => { const result = complaintIdSchema.safeParse(req.params); if (!result.success) return next(result.error); next(); };
const validateTenantQuery: RequestHandler = (req, _res, next) => { const result = tenantListQuerySchema.safeParse(req.query); if (!result.success) return next(result.error); Object.assign(req, { complaintQuery: result.data }); next(); };
const validateOwnerQuery: RequestHandler = (req, _res, next) => { const result = ownerListQuerySchema.safeParse(req.query); if (!result.success) return next(result.error); Object.assign(req, { complaintQuery: result.data }); next(); };
const query = (req: Request) => (req as Request & { complaintQuery: Query }).complaintQuery;
const id = (req: Request) => req.params.complaintId as string;
const noCache: RequestHandler = (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); };

export function createComplaintRouter(service: ComplaintService, auth: AuthRepository, findAccess: (id: string) => Promise<TenantRecordAccess | null>) {
  const router = Router();
  const signedIn = authenticate(auth);
  const access = authorizeTenantRecord(findAccess, "complaintId");
  router.use(noCache);

  router.post("/complaints", signedIn, requireRole("TENANT"), requireCsrf, validateBody(createComplaintSchema), async (req, res, next) => {
    try { res.status(201).json({ complaint: await service.create(req.auth!.user.id, req.body) }); } catch (error) { next(error); }
  });
  router.get("/complaints", signedIn, requireRole("TENANT"), validateTenantQuery, async (req, res, next) => {
    try { res.json({ complaints: await service.listTenant(req.auth!.user.id, query(req).status) }); } catch (error) { next(error); }
  });
  router.get("/complaints/:complaintId", signedIn, requireRole("TENANT"), validateId, async (req, res, next) => {
    try { const complaint = await service.getTenant(id(req), req.auth!.user.id); if (!complaint) { res.status(404).json(notFound); return; } res.json({ complaint }); } catch (error) { next(error); }
  });
  router.post("/complaints/:complaintId/activities", signedIn, requireRole("TENANT"), validateId, access, requireCsrf, validateBody(activitySchema), async (req, res, next) => {
    try { const complaint = await service.addActivity(id(req), req.auth!.user.id, req.body.message); if (!complaint) { res.status(404).json(notFound); return; } res.status(201).json({ complaint }); } catch (error) { next(error); }
  });

  router.get("/owner/complaints", signedIn, requireRole("OWNER", "ADMIN"), validateOwnerQuery, async (req, res, next) => {
    try { res.json({ complaints: await service.listOwner(req.auth!.user.role === "ADMIN" ? null : req.auth!.user.id, query(req)) }); } catch (error) { next(error); }
  });
  router.get("/owner/complaints/:complaintId", signedIn, requireRole("OWNER", "ADMIN"), validateId, access, async (req, res, next) => {
    try { const complaint = await service.getOwner(id(req)); if (!complaint) { res.status(404).json(notFound); return; } res.json({ complaint }); } catch (error) { next(error); }
  });
  router.patch("/owner/complaints/:complaintId", signedIn, requireRole("OWNER", "ADMIN"), validateId, access, requireCsrf, validateBody(updateComplaintSchema), async (req, res, next) => {
    try { await service.updateOwner(id(req), req.auth!.user.id, req.body); const complaint = await service.getOwner(id(req)); res.json({ complaint }); } catch (error) { next(error); }
  });
  router.post("/owner/complaints/:complaintId/activities", signedIn, requireRole("OWNER", "ADMIN"), validateId, access, requireCsrf, validateBody(activitySchema), async (req, res, next) => {
    try { const complaint = await service.addActivity(id(req), req.auth!.user.id, req.body.message); if (!complaint) { res.status(404).json(notFound); return; } res.status(201).json({ complaint }); } catch (error) { next(error); }
  });
  return router;
}
const notFound = { error: { code: "NOT_FOUND", message: "Complaint not found." } };
