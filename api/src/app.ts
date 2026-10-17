import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { createAuthRouter } from "./auth/routes.js";
import { createPrismaAuthRepository } from "./auth/prisma-auth-repository.js";
import { createPrismaResourceAccess } from "./auth/prisma-resource-access.js";
import { argon2PasswordHasher } from "./auth/password.js";
import type { AuthRepository, PasswordHasher } from "./auth/types.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { originGuard } from "./middleware/origin-guard.js";
import { healthRouter } from "./routes/health.js";
import { prisma } from "./services/prisma.js";
import { createPrismaPropertyRepository } from "./properties/prisma-repository.js";
import { createPropertyRouter } from "./properties/routes.js";
import { PropertyService, type PropertyRepository } from "./properties/service.js";
import type { PropertyAccessRepository, TenantRecordAccess } from "./middleware/resource-authorization.js";
import { BookingService, type BookingRepository } from "./bookings/service.js";
import { createPrismaBookingRepository } from "./bookings/prisma-repository.js";
import { createBookingRouter } from "./bookings/routes.js";
import { createPrismaTenancyRepository } from "./tenancies/prisma-repository.js";
import { createTenancyRouter } from "./tenancies/routes.js";
import { TenancyService, type TenancyRepository } from "./tenancies/service.js";
import { createPrismaBillingRepository } from "./billing/prisma-repository.js";
import { createBillingRouter } from "./billing/routes.js";
import { BillingService, type BillingRepository } from "./billing/service.js";

interface CreateAppOptions {
  authRepository?: AuthRepository;
  passwordHasher?: PasswordHasher;
  webOrigin?: string;
  loginLimit?: number;
  propertyRepository?: PropertyRepository;
  propertyAccess?: PropertyAccessRepository;
  bookingRepository?: BookingRepository;
  bookingAccess?: (bookingId: string) => Promise<TenantRecordAccess | null>;
  tenancyRepository?: TenancyRepository;
  tenancyAccess?: (tenancyId: string) => Promise<TenantRecordAccess | null>;
  billingRepository?: BillingRepository;
  invoiceAccess?: (invoiceId: string) => Promise<TenantRecordAccess | null>;
}

export function createApp(options: CreateAppOptions = {}) {
  const webOrigin = options.webOrigin ?? env.WEB_ORIGIN;
  const authRepository = options.authRepository ?? createPrismaAuthRepository(prisma);
  const app = express();

  app.disable("x-powered-by");
  app.use(originGuard(webOrigin));
  app.use(cors({
    origin: webOrigin,
    credentials: true,
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api/v1", healthRouter);
  app.use("/api/v1/auth", createAuthRouter({
    repository: authRepository,
    passwords: options.passwordHasher ?? argon2PasswordHasher,
    loginLimit: options.loginLimit,
  }));
  const prismaResourceAccess = createPrismaResourceAccess(prisma);
  app.use("/api/v1", createPropertyRouter(
    new PropertyService(options.propertyRepository ?? createPrismaPropertyRepository(prisma)),
    authRepository,
    options.propertyAccess ?? prismaResourceAccess,
  ));
  app.use("/api/v1", createBookingRouter(
    new BookingService(options.bookingRepository ?? createPrismaBookingRepository(prisma)),
    authRepository,
    options.bookingAccess ?? ((bookingId) => prismaResourceAccess.findBookingAccess(bookingId)),
  ));
  app.use("/api/v1", createTenancyRouter(
    new TenancyService(options.tenancyRepository ?? createPrismaTenancyRepository(prisma)),
    authRepository,
    options.tenancyAccess ?? ((tenancyId) => prismaResourceAccess.findTenancyAccess(tenancyId)),
    options.bookingAccess ?? ((bookingId) => prismaResourceAccess.findBookingAccess(bookingId)),
  ));
  app.use("/api/v1", createBillingRouter(
    new BillingService(options.billingRepository ?? createPrismaBillingRepository(prisma)),
    authRepository,
    options.invoiceAccess ?? ((invoiceId) => prismaResourceAccess.findInvoiceAccess(invoiceId)),
    options.tenancyAccess ?? ((tenancyId) => prismaResourceAccess.findTenancyAccess(tenancyId)),
  ));
  app.use((_request, response) => {
    response.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found." } });
  });
  app.use(errorHandler);
  return app;
}

export const app = createApp();
