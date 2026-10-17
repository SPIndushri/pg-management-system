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
import { createPrismaComplaintRepository } from "./complaints/prisma-repository.js";
import { createComplaintRouter } from "./complaints/routes.js";
import { ComplaintService, type ComplaintRepository } from "./complaints/service.js";
import { createDashboardRouter } from "./dashboard/routes.js";
import { createPrismaDashboardRepository } from "./dashboard/prisma-repository.js";
import { DashboardService, type DashboardRepository } from "./dashboard/service.js";
import { createHealthRouter } from "./routes/health.js";

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
  complaintRepository?: ComplaintRepository;
  complaintAccess?: (complaintId: string) => Promise<TenantRecordAccess | null>;
  dashboardRepository?: DashboardRepository;
  databaseCheck?: () => Promise<void>;
}

export function createApp(options: CreateAppOptions = {}) {
  const webOrigin = options.webOrigin ?? env.WEB_ORIGIN;
  const authRepository = options.authRepository ?? createPrismaAuthRepository(prisma);
  const app = express();

  app.disable("x-powered-by");
  // Do not trust forwarded headers until the production proxy topology is explicitly configured.
  app.set("trust proxy", false);
  app.use(originGuard(webOrigin));
  app.use(cors({
    origin: webOrigin,
    credentials: true,
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api/v1", createHealthRouter(options.databaseCheck ?? (async () => {
    await prisma.$queryRaw`SELECT 1`;
  })));
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
  app.use("/api/v1", createComplaintRouter(
    new ComplaintService(options.complaintRepository ?? createPrismaComplaintRepository(prisma)),
    authRepository,
    options.complaintAccess ?? ((complaintId) => prismaResourceAccess.findComplaintAccess(complaintId)),
  ));
  app.use("/api/v1", createDashboardRouter(
    new DashboardService(options.dashboardRepository ?? createPrismaDashboardRepository(prisma)),
    authRepository,
  ));
  app.use((_request, response) => {
    response.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found." } });
  });
  app.use(errorHandler);
  return app;
}

export const app = createApp();
