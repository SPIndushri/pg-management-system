import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate, requireCsrf, requireRole } from "../middleware/authentication.js";
import { authorizePropertyOwner, type PropertyAccessRepository } from "../middleware/resource-authorization.js";
import { validateBody } from "../middleware/validate-body.js";
import type { AuthRepository } from "../auth/types.js";
import { PropertyService } from "./service.js";
import { bedCreateSchema, bedUpdateSchema, browseQuerySchema, propertyCreateSchema, propertyUpdateSchema, roomCreateSchema, roomUpdateSchema } from "./schemas.js";

const idSchema = z.object({ propertyId: z.string().uuid(), roomId: z.string().uuid().optional(), bedId: z.string().uuid().optional() });
const validateIds: RequestHandler = (req, _res, next) => {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) { next(parsed.error); return; }
  next();
};
const query: RequestHandler = (req, _res, next) => {
  const parsed = browseQuerySchema.safeParse(req.query);
  if (!parsed.success) { next(parsed.error); return; }
  Object.assign(req, { browse: parsed.data });
  next();
};
const getQuery = (req: Request) => (req as Request & { browse: z.infer<typeof browseQuerySchema> }).browse;
const param = (req: Request, name: string) => {
  const value = req.params[name];
  return typeof value === "string" ? value : value[0];
};

export function createPropertyRouter(service: PropertyService, auth: AuthRepository, access: PropertyAccessRepository) {
  const router = Router();
  const authenticated = authenticate(auth);
  router.get("/properties", query, async (req, res, next) => {
    try { res.json(await service.browse(getQuery(req))); } catch (error) { next(error); }
  });
  router.get("/properties/:propertyId", validateIds, query, async (req, res, next) => {
    try {
      const result = await service.publicDetail(param(req, "propertyId"), getQuery(req));
      if (!result) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Property not found." } }); return; }
      res.json({ property: result });
    } catch (error) { next(error); }
  });

  const managed = Router();
  managed.use(authenticated, requireRole("OWNER", "ADMIN"));
  managed.get("/properties", async (req, res, next) => {
    try { res.json({ properties: await service.managed(req.auth!.user.role === "ADMIN" ? null : req.auth!.user.id) }); } catch (error) { next(error); }
  });
  managed.post("/properties", requireRole("OWNER"), requireCsrf, validateBody(propertyCreateSchema), async (req, res, next) => {
    try { res.status(201).json({ property: await service.create(req.auth!.user.id, req.body) }); } catch (error) { next(error); }
  });
  const ownerProperty = authorizePropertyOwner(access, "propertyId");
  managed.get("/properties/:propertyId", validateIds, ownerProperty, async (req, res, next) => {
    try { const value = await service.get(param(req, "propertyId")); value ? res.json({ property: value }) : res.status(404).json(notFound); } catch (error) { next(error); }
  });
  managed.patch("/properties/:propertyId", validateIds, ownerProperty, requireCsrf, validateBody(propertyUpdateSchema), async (req, res, next) => {
    try { const value = await service.update(param(req, "propertyId"), req.body); value ? res.json({ property: value }) : res.status(404).json(notFound); } catch (error) { next(error); }
  });
  managed.delete("/properties/:propertyId", validateIds, ownerProperty, requireCsrf, async (req, res, next) => {
    try { await finishDelete(res, await service.remove(param(req, "propertyId"))); } catch (error) { next(error); }
  });
  managed.get("/properties/:propertyId/rooms", validateIds, ownerProperty, async (req, res, next) => {
    try { const rooms = await service.rooms(param(req, "propertyId")); rooms === null ? res.status(404).json(notFound) : res.json({ rooms }); } catch (error) { next(error); }
  });
  managed.post("/properties/:propertyId/rooms", validateIds, ownerProperty, requireCsrf, validateBody(roomCreateSchema), async (req, res, next) => {
    try { const room = await service.addRoom(param(req, "propertyId"), req.body); room ? res.status(201).json({ room }) : res.status(404).json(notFound); } catch (error) { next(error); }
  });
  managed.patch("/properties/:propertyId/rooms/:roomId", validateIds, ownerProperty, requireCsrf, validateBody(roomUpdateSchema), async (req, res, next) => {
    try { const room = await service.updateRoom(param(req, "propertyId"), param(req, "roomId"), req.body); room ? res.json({ room }) : res.status(404).json(notFound); } catch (error) { next(error); }
  });
  managed.delete("/properties/:propertyId/rooms/:roomId", validateIds, ownerProperty, requireCsrf, async (req, res, next) => {
    try { await finishDelete(res, await service.removeRoom(param(req, "propertyId"), param(req, "roomId"))); } catch (error) { next(error); }
  });
  managed.get("/properties/:propertyId/rooms/:roomId/beds", validateIds, ownerProperty, async (req, res, next) => {
    try { const beds = await service.beds(param(req, "propertyId"), param(req, "roomId")); beds === null ? res.status(404).json(notFound) : res.json({ beds }); } catch (error) { next(error); }
  });
  managed.post("/properties/:propertyId/rooms/:roomId/beds", validateIds, ownerProperty, requireCsrf, validateBody(bedCreateSchema), async (req, res, next) => {
    try { const bed = await service.addBed(param(req, "propertyId"), param(req, "roomId"), req.body); bed ? res.status(201).json({ bed }) : res.status(404).json(notFound); } catch (error) { next(error); }
  });
  managed.patch("/properties/:propertyId/rooms/:roomId/beds/:bedId", validateIds, ownerProperty, requireCsrf, validateBody(bedUpdateSchema), async (req, res, next) => {
    try { const bed = await service.updateBed(param(req, "propertyId"), param(req, "roomId"), param(req, "bedId"), req.body); bed ? res.json({ bed }) : res.status(404).json(notFound); } catch (error) { next(error); }
  });
  managed.delete("/properties/:propertyId/rooms/:roomId/beds/:bedId", validateIds, ownerProperty, requireCsrf, async (req, res, next) => {
    try { await finishDelete(res, await service.removeBed(param(req, "propertyId"), param(req, "roomId"), param(req, "bedId"))); } catch (error) { next(error); }
  });
  router.use("/owner", managed);
  return router;
}

const notFound = { error: { code: "NOT_FOUND", message: "Resource not found." } };
function finishDelete(response: import("express").Response, result: "deleted" | "missing" | "in-use") {
  if (result === "deleted") { response.status(204).end(); return; }
  if (result === "missing") { response.status(404).json(notFound); return; }
  response.status(409).json({ error: { code: "RESOURCE_IN_USE", message: "This resource has dependent records and cannot be deleted." } });
}
