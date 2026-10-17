import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AuthenticationError } from "../auth/service.js";
import { BookingWorkflowError } from "../bookings/service.js";
import { TenancyWorkflowError } from "../tenancies/service.js";
import { BillingWorkflowError } from "../billing/service.js";
import { ComplaintWorkflowError } from "../complaints/service.js";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AuthenticationError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  if (error instanceof BookingWorkflowError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  if (error instanceof TenancyWorkflowError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  if (error instanceof BillingWorkflowError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  if (error instanceof ComplaintWorkflowError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        issues: error.issues.map(({ path, message }) => ({ path, message })),
      },
    });
    return;
  }

  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "RESOURCE_IN_USE") {
      response.status(409).json({ error: { code: "RESOURCE_IN_USE", message: "This resource has active dependent records and cannot be changed." } });
      return;
    }
    if (code === "P2002") {
      response.status(409).json({ error: { code: "CONFLICT", message: "A resource with those details already exists." } });
      return;
    }
    if (code === "P2003" || code === "P2014" || code === "P2004" || code === "P2034") {
      response.status(409).json({ error: { code: "RESOURCE_IN_USE", message: "This resource has dependent records and cannot be changed." } });
      return;
    }
    if (code === "P2025") {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found." } });
      return;
    }
  }

  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
  });
};
