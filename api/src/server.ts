import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./services/prisma.js";

async function start(): Promise<void> {
  try {
    await prisma.$connect();
  } catch {
    // Prisma connection errors can include connection strings; report no raw error details.
    console.error("API startup aborted: PostgreSQL connection failed. Verify DATABASE_URL and database availability.");
    await prisma.$disconnect().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  const server = app.listen(env.API_PORT, () => {
    console.log(`API listening on configured port ${env.API_PORT}.`);
  });
  server.once("error", () => {
    console.error("API could not bind to its configured port.");
    process.exitCode = 1;
    void prisma.$disconnect().catch(() => {
      console.error("Database client shutdown encountered an error.");
    });
  });
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down API.`);
    server.close((error) => {
      if (error) {
        console.error("HTTP server shutdown encountered an error.");
        process.exitCode = 1;
      }
      void prisma.$disconnect().catch(() => {
        console.error("Database client shutdown encountered an error.");
        process.exitCode = 1;
      });
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void start().catch(() => {
  console.error("API startup failed due to an unexpected initialization error.");
  process.exitCode = 1;
});
