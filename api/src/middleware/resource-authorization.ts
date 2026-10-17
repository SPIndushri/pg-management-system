import type { RequestHandler, Response } from "express";

export interface PropertyAccessRepository {
  findPropertyOwnerId(propertyId: string): Promise<string | null>;
}

export interface TenantRecordAccess {
  tenantId: string;
  propertyOwnerId: string;
}

export function authorizePropertyOwner(
  repository: PropertyAccessRepository,
  propertyIdParam = "propertyId",
): RequestHandler {
  return async (request, response, next) => {
    const auth = request.auth;
    if (!auth) {
      response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } });
      return;
    }
    if (auth.user.role === "ADMIN") {
      next();
      return;
    }

    const propertyId = routeParam(request, propertyIdParam);
    if (auth.user.role !== "OWNER" || !propertyId) {
      notFound(response);
      return;
    }
    try {
      const ownerId = await repository.findPropertyOwnerId(propertyId);
      if (ownerId !== auth.user.id) {
        notFound(response);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function authorizeTenantRecord(
  findAccess: (recordId: string) => Promise<TenantRecordAccess | null>,
  recordIdParam = "recordId",
): RequestHandler {
  return async (request, response, next) => {
    const auth = request.auth;
    if (!auth) {
      response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } });
      return;
    }
    if (auth.user.role === "ADMIN") {
      next();
      return;
    }

    const recordId = routeParam(request, recordIdParam);
    if (!recordId) {
      notFound(response);
      return;
    }
    try {
      const access = await findAccess(recordId);
      const isTenant = auth.user.role === "TENANT" && access?.tenantId === auth.user.id;
      const isPropertyOwner = auth.user.role === "OWNER" && access?.propertyOwnerId === auth.user.id;
      if (!isTenant && !isPropertyOwner) {
        notFound(response);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function routeParam(request: Parameters<RequestHandler>[0], name: string): string | undefined {
  const value = request.params[name];
  return typeof value === "string" ? value : undefined;
}

function notFound(response: Response): void {
  response.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found." } });
}
