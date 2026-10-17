import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().optional(),
  WEB_ORIGIN: z.string().url().optional(),
}).superRefine((value, context) => {
  if (value.DATABASE_URL) {
    try {
      const databaseUrl = new URL(value.DATABASE_URL);
      if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
        context.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "must use PostgreSQL" });
      }
    } catch {
      context.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "must be a valid PostgreSQL URL" });
    }
  }

  if (value.NODE_ENV !== "production") return;

  if (!value.DATABASE_URL) {
    context.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "is required in production" });
  } else {
    try {
      const databaseUrl = new URL(value.DATABASE_URL);
      const sslMode = databaseUrl.searchParams.get("sslmode")?.toLowerCase();
      if (!sslMode || !["require", "verify-ca", "verify-full"].includes(sslMode)) {
        context.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "must require PostgreSQL TLS with sslmode=require, verify-ca, or verify-full" });
      }
    } catch {
      // The general URL validation above reports malformed values without exposing them.
    }
  }

  if (!value.WEB_ORIGIN) {
    context.addIssue({ code: "custom", path: ["WEB_ORIGIN"], message: "is required in production" });
  } else {
    try {
      const origin = new URL(value.WEB_ORIGIN);
      if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
        context.addIssue({ code: "custom", path: ["WEB_ORIGIN"], message: "must be an HTTPS origin without credentials, path, query, or fragment" });
      }
    } catch {
      // URL validation above reports malformed values.
    }
  }
});

export function parseEnvironment(source: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(source);
  if (result.success) {
    const webOrigin = result.data.WEB_ORIGIN ?? "http://localhost:5173";
    return { ...result.data, WEB_ORIGIN: new URL(webOrigin).origin };
  }

  // Zod's default error rendering may include input values. Report field names only.
  const fields = [...new Set(result.error.issues.map((issue) => issue.path[0]).filter((field): field is string | number => field !== undefined))];
  throw new Error(`Invalid environment configuration for: ${fields.join(", ") || "unknown setting"}.`);
}

export const env = parseEnvironment(process.env);
