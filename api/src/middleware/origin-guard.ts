import type { RequestHandler } from "express";

export function originGuard(allowedOrigin: string): RequestHandler {
  return (request, response, next) => {
    const origin = request.get("origin");
    if (origin && origin !== allowedOrigin) {
      response.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Request origin is not allowed." } });
      return;
    }
    next();
  };
}
