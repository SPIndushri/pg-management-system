import { Router } from "express";

export function createHealthRouter(checkDatabase: () => Promise<void>) {
  const router = Router();

  // Process liveness is intentionally independent of PostgreSQL availability.
  router.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  router.get("/health/ready", async (_request, response) => {
    try {
      await checkDatabase();
      response.status(200).json({ status: "ready" });
    } catch {
      // Never serialize database exceptions, which may contain connection details.
      response.status(503).json({ status: "not_ready" });
    }
  });

  return router;
}
