import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { AuthRepository } from "../auth/types.js";
import { authenticate, requireCsrf, requireRole } from "../middleware/authentication.js";
import { authorizeTenantRecord, type TenantRecordAccess } from "../middleware/resource-authorization.js";
import { validateBody } from "../middleware/validate-body.js";
import { TenancyService } from "./service.js";

const idSchema = z.object({ tenancyId: z.string().uuid().optional(), bookingId: z.string().uuid().optional() });
const validateIds: RequestHandler = (request, _response, next) => {
  const parsed = idSchema.safeParse(request.params);
  if (!parsed.success) { next(parsed.error); return; }
  next();
};
const emptyBody = z.object({}).strict();
const validateEmptyBody = validateBody(emptyBody);
const value = (request: import("express").Request, name: string) => {
  const param = request.params[name];
  return typeof param === "string" ? param : param[0];
};
const notFound = { error: { code: "NOT_FOUND", message: "Tenancy not found." } };

export function createTenancyRouter(
  service: TenancyService,
  auth: AuthRepository,
  findTenancyAccess: (id: string) => Promise<TenantRecordAccess | null>,
  findBookingAccess: (id: string) => Promise<TenantRecordAccess | null>,
) {
  const router = Router();
  const authenticated = authenticate(auth);
  const tenancyAccess = authorizeTenantRecord(findTenancyAccess, "tenancyId");
  const bookingAccess = authorizeTenantRecord(findBookingAccess, "bookingId");
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });

  router.get("/tenancies", authenticated, requireRole("TENANT"), async (request, response, next) => {
    try { response.json({ tenancies: await service.tenantList(request.auth!.user.id) }); } catch (error) { next(error); }
  });
  router.get("/tenancies/:tenancyId", authenticated, requireRole("TENANT"), validateIds, async (request, response, next) => {
    try {
      const tenancy = await service.tenantDetail(value(request, "tenancyId"), request.auth!.user.id);
      if (!tenancy) { response.status(404).json(notFound); return; }
      response.json({ tenancy });
    } catch (error) { next(error); }
  });
  router.get("/owner/tenancies", authenticated, requireRole("OWNER", "ADMIN"), async (request, response, next) => {
    try { response.json({ tenancies: await service.ownerList(request.auth!.user.role === "ADMIN" ? null : request.auth!.user.id) }); } catch (error) { next(error); }
  });
  router.get("/owner/tenancies/:tenancyId", authenticated, requireRole("OWNER", "ADMIN"), validateIds, tenancyAccess, async (request, response, next) => {
    try {
      const tenancy = await service.ownerDetail(value(request, "tenancyId"));
      if (!tenancy) { response.status(404).json(notFound); return; }
      response.json({ tenancy });
    } catch (error) { next(error); }
  });
  router.post("/owner/bookings/:bookingId/check-in", authenticated, requireRole("OWNER", "ADMIN"), validateIds, bookingAccess, requireCsrf, validateEmptyBody, async (request, response, next) => {
    try {
      const result = await service.checkInFromBooking(value(request, "bookingId"));
      response.status(result.repeated ? 200 : 201).json({ tenancy: result.tenancy, repeated: result.repeated });
    } catch (error) { next(error); }
  });
  router.post("/owner/tenancies/:tenancyId/check-out", authenticated, requireRole("OWNER", "ADMIN"), validateIds, tenancyAccess, requireCsrf, validateEmptyBody, async (request, response, next) => {
    try {
      const result = await service.checkOut(value(request, "tenancyId"));
      response.json({ tenancy: result.tenancy, repeated: result.repeated });
    } catch (error) { next(error); }
  });
  return router;
}
