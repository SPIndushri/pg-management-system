import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { AuthRepository } from "../auth/types.js";
import { authenticate, requireCsrf, requireRole } from "../middleware/authentication.js";
import { authorizeTenantRecord, type TenantRecordAccess } from "../middleware/resource-authorization.js";
import { validateBody } from "../middleware/validate-body.js";
import { BookingService } from "./service.js";
import { bookingIdParamsSchema, createBookingSchema, ownerBookingQuerySchema } from "./schemas.js";

const validateId: RequestHandler = (request, _response, next) => {
  const parsed = bookingIdParamsSchema.safeParse(request.params);
  if (!parsed.success) { next(parsed.error); return; }
  next();
};
const validateOwnerQuery: RequestHandler = (request, _response, next) => {
  const parsed = ownerBookingQuerySchema.safeParse(request.query);
  if (!parsed.success) { next(parsed.error); return; }
  Object.assign(request, { bookingQuery: parsed.data });
  next();
};
const getOwnerQuery = (request: Request) => (request as Request & { bookingQuery: z.infer<typeof ownerBookingQuerySchema> }).bookingQuery;
const emptyBodySchema = z.object({}).strict();
const validateEmptyBody: RequestHandler = (request, _response, next) => {
  const parsed = emptyBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) { next(parsed.error); return; }
  next();
};
const bookingId = (request: Request) => {
  const value = request.params.bookingId;
  return typeof value === "string" ? value : value[0];
};

export function createBookingRouter(
  service: BookingService,
  auth: AuthRepository,
  findBookingAccess: (id: string) => Promise<TenantRecordAccess | null>,
) {
  const router = Router();
  const authenticated = authenticate(auth);
  const ownerAccess = authorizeTenantRecord(findBookingAccess, "bookingId");
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });

  router.post("/bookings", authenticated, requireRole("TENANT"), requireCsrf, validateBody(createBookingSchema), async (request, response, next) => {
    try {
      const booking = await service.request(request.auth!.user.id, request.body);
      response.status(201).json({ booking });
    } catch (error) { next(error); }
  });
  router.get("/bookings", authenticated, requireRole("TENANT"), async (request, response, next) => {
    try { response.json({ bookings: await service.tenantBookings(request.auth!.user.id) }); } catch (error) { next(error); }
  });
  router.get("/bookings/:bookingId", authenticated, requireRole("TENANT"), validateId, async (request, response, next) => {
    try {
      const booking = await service.tenantBooking(bookingId(request), request.auth!.user.id);
      if (!booking) { response.status(404).json(notFound); return; }
      response.json({ booking });
    } catch (error) { next(error); }
  });
  router.post("/bookings/:bookingId/cancel", authenticated, requireRole("TENANT"), validateId, requireCsrf, validateEmptyBody, async (request, response, next) => {
    try {
      await service.cancelAsTenant(bookingId(request), request.auth!.user.id);
      response.json({ booking: { id: bookingId(request), status: "CANCELLED" } });
    } catch (error) { next(error); }
  });

  router.get("/owner/bookings", authenticated, requireRole("OWNER", "ADMIN"), validateOwnerQuery, async (request, response, next) => {
    try {
      const ownerId = request.auth!.user.role === "ADMIN" ? null : request.auth!.user.id;
      response.json({ bookings: await service.ownerBookings(ownerId, getOwnerQuery(request)) });
    } catch (error) { next(error); }
  });
  router.get("/owner/bookings/:bookingId", authenticated, requireRole("OWNER", "ADMIN"), validateId, ownerAccess, async (request, response, next) => {
    try {
      const booking = await service.ownerBooking(bookingId(request));
      if (!booking) { response.status(404).json(notFound); return; }
      response.json({ booking });
    } catch (error) { next(error); }
  });
  router.post("/owner/bookings/:bookingId/approve", authenticated, requireRole("OWNER", "ADMIN"), validateId, ownerAccess, requireCsrf, validateEmptyBody, async (request, response, next) => {
    try {
      await service.approve(bookingId(request));
      response.json({ booking: { id: bookingId(request), status: "CONFIRMED" } });
    } catch (error) { next(error); }
  });
  router.post("/owner/bookings/:bookingId/reject", authenticated, requireRole("OWNER", "ADMIN"), validateId, ownerAccess, requireCsrf, validateEmptyBody, async (request, response, next) => {
    try {
      await service.reject(bookingId(request));
      response.json({ booking: { id: bookingId(request), status: "REJECTED" } });
    } catch (error) { next(error); }
  });
  router.post("/owner/bookings/:bookingId/cancel", authenticated, requireRole("OWNER", "ADMIN"), validateId, ownerAccess, requireCsrf, validateEmptyBody, async (request, response, next) => {
    try {
      await service.cancelAsOwner(bookingId(request));
      response.json({ booking: { id: bookingId(request), status: "CANCELLED" } });
    } catch (error) { next(error); }
  });
  return router;
}

const notFound = { error: { code: "NOT_FOUND", message: "Booking not found." } };
