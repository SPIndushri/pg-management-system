import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { AuthRepository } from "../auth/types.js";
import { authenticate, requireCsrf, requireRole } from "../middleware/authentication.js";
import { authorizeTenantRecord, type TenantRecordAccess } from "../middleware/resource-authorization.js";
import { validateBody } from "../middleware/validate-body.js";
import { BillingService } from "./service.js";
import { createInvoiceSchema, invoiceIdParamsSchema, recordPaymentSchema, tenancyIdParamsSchema } from "./schemas.js";

const validateInvoiceId: RequestHandler = (request, _response, next) => {
  const parsed = invoiceIdParamsSchema.safeParse(request.params);
  if (!parsed.success) { next(parsed.error); return; }
  next();
};
const validateTenancyId: RequestHandler = (request, _response, next) => {
  const parsed = tenancyIdParamsSchema.safeParse(request.params);
  if (!parsed.success) { next(parsed.error); return; }
  next();
};
const param = (request: import("express").Request, name: string) => {
  const value = request.params[name];
  return typeof value === "string" ? value : value[0];
};
const notFound = { error: { code: "NOT_FOUND", message: "Invoice not found." } };

export function createBillingRouter(
  service: BillingService,
  auth: AuthRepository,
  findInvoiceAccess: (id: string) => Promise<TenantRecordAccess | null>,
  findTenancyAccess: (id: string) => Promise<TenantRecordAccess | null>,
) {
  const router = Router();
  const authenticated = authenticate(auth);
  const invoiceAccess = authorizeTenantRecord(findInvoiceAccess, "invoiceId");
  const tenancyAccess = authorizeTenantRecord(findTenancyAccess, "tenancyId");
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });

  router.get("/invoices", authenticated, requireRole("TENANT"), async (request, response, next) => {
    try { response.json({ invoices: await service.tenantInvoices(request.auth!.user.id) }); } catch (error) { next(error); }
  });
  router.get("/invoices/:invoiceId", authenticated, requireRole("TENANT"), validateInvoiceId, async (request, response, next) => {
    try {
      const invoice = await service.tenantInvoice(param(request, "invoiceId"), request.auth!.user.id);
      if (!invoice) { response.status(404).json(notFound); return; }
      response.json({ invoice });
    } catch (error) { next(error); }
  });
  router.get("/owner/invoices", authenticated, requireRole("OWNER", "ADMIN"), async (request, response, next) => {
    try { response.json({ invoices: await service.ownerInvoices(request.auth!.user.role === "ADMIN" ? null : request.auth!.user.id) }); } catch (error) { next(error); }
  });
  router.get("/owner/invoices/:invoiceId", authenticated, requireRole("OWNER", "ADMIN"), validateInvoiceId, invoiceAccess, async (request, response, next) => {
    try {
      const invoice = await service.ownerInvoice(param(request, "invoiceId"));
      if (!invoice) { response.status(404).json(notFound); return; }
      response.json({ invoice });
    } catch (error) { next(error); }
  });
  router.post("/owner/tenancies/:tenancyId/invoices", authenticated, requireRole("OWNER", "ADMIN"), validateTenancyId, tenancyAccess, requireCsrf, validateBody(createInvoiceSchema), async (request, response, next) => {
    try {
      const invoice = await service.createInvoice(param(request, "tenancyId"), request.body);
      response.status(201).json({ invoice });
    } catch (error) { next(error); }
  });
  router.post("/owner/invoices/:invoiceId/payments", authenticated, requireRole("OWNER", "ADMIN"), validateInvoiceId, invoiceAccess, requireCsrf, validateBody(recordPaymentSchema), async (request, response, next) => {
    try {
      const result = await service.recordPayment(param(request, "invoiceId"), request.body);
      response.status(result.repeated ? 200 : 201).json({ invoice: result.invoice, repeated: result.repeated });
    } catch (error) { next(error); }
  });
  return router;
}
