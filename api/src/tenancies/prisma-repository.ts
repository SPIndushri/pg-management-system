import type { Prisma, PrismaClient } from "@prisma/client";
import type { EndResult, TenancyRepository } from "./service.js";

const tenancySelect = {
  id: true, tenantId: true, bedId: true, bookingId: true, startDate: true, endDate: true,
  status: true, checkedInAt: true, checkedOutAt: true, createdAt: true, updatedAt: true,
  tenant: { select: { id: true, fullName: true, email: true } },
  bed: { select: { id: true, label: true, room: { select: { id: true, roomNumber: true, property: { select: { id: true, name: true, city: true, region: true } } } } } },
} satisfies Prisma.TenancySelect;
const overlapping = (start: Date, end: Date) => ({ startDate: { lt: end }, OR: [{ endDate: null }, { endDate: { gt: start } }] });
type Transaction = Prisma.TransactionClient;

async function lockBed(transaction: Transaction, bedId: string): Promise<void> {
  // Shares the transaction-scoped advisory key with booking creation/approval.
  // Hash collisions serialize extra work only; PostgreSQL exclusion constraints remain the final guard.
  await transaction.$queryRaw`SELECT 1::int WHERE pg_advisory_xact_lock(hashtextextended(${bedId}, 0)) IS NULL`;
}

async function hasConflict(transaction: Transaction, bedId: string, start: Date, end: Date, exceptBookingId: string): Promise<boolean> {
  const confirmed = await transaction.booking.findFirst({
    where: { bedId, status: "CONFIRMED", id: { not: exceptBookingId }, ...overlapping(start, end) }, select: { id: true },
  });
  if (confirmed) return true;
  const active = await transaction.tenancy.findFirst({ where: { bedId, status: "ACTIVE", ...overlapping(start, end) }, select: { id: true } });
  return active !== null;
}

function exclusionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : undefined;
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return code === "P2004" || code === "P2034" || message.includes("Tenancy_no_overlapping_active_bed_periods") || message.includes("23P01");
}

export function createPrismaTenancyRepository(prisma: PrismaClient): TenancyRepository {
  return {
    async convertConfirmedBooking(bookingId, today, checkedInAt) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const initial = await transaction.booking.findUnique({ where: { id: bookingId }, select: { id: true, bedId: true } });
          if (!initial) return { kind: "missing" as const };
          await lockBed(transaction, initial.bedId);
          // Read Committed takes a fresh snapshot after the lock wait, matching booking approval.
          const booking = await transaction.booking.findUnique({
            where: { id: bookingId },
            select: { id: true, tenantId: true, bedId: true, startDate: true, endDate: true, status: true },
          });
          if (!booking) return { kind: "missing" as const };
          const prior = await transaction.tenancy.findUnique({ where: { bookingId }, select: tenancySelect });
          if (prior) return { kind: "existing" as const, tenancy: prior };
          if (booking.status !== "CONFIRMED" || !booking.endDate || booking.endDate <= booking.startDate) return { kind: "invalid" as const };
          if (booking.startDate > today) return { kind: "too-early" as const };
          // All authoritative fields are derived from the locked, re-read confirmed booking.
          if (await hasConflict(transaction, booking.bedId, booking.startDate, booking.endDate, booking.id)) return { kind: "conflict" as const };
          const tenancy = await transaction.tenancy.create({
            data: {
              bookingId: booking.id, tenantId: booking.tenantId, bedId: booking.bedId,
              startDate: booking.startDate, endDate: booking.endDate,
              status: "ACTIVE", checkedInAt,
            },
            select: tenancySelect,
          });
          return { kind: "created" as const, tenancy };
        }, { maxWait: 5_000, timeout: 10_000 });
      } catch (error) {
        if (exclusionConflict(error)) return { kind: "conflict" as const };
        throw error;
      }
    },

    listTenant(tenantId) {
      return prisma.tenancy.findMany({ where: { tenantId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: tenancySelect });
    },
    findTenant(tenancyId, tenantId) {
      return prisma.tenancy.findFirst({ where: { id: tenancyId, tenantId }, select: tenancySelect });
    },
    listOwner(ownerId) {
      return prisma.tenancy.findMany({
        where: ownerId ? { bed: { room: { property: { ownerId } } } } : {},
        orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: tenancySelect,
      });
    },
    findOwner(tenancyId) { return prisma.tenancy.findUnique({ where: { id: tenancyId }, select: tenancySelect }); },

    async checkOut(tenancyId, checkedOutAt): Promise<{ kind: EndResult; tenancy?: unknown }> {
      return prisma.$transaction(async (transaction) => {
        const initial = await transaction.tenancy.findUnique({ where: { id: tenancyId }, select: { bedId: true } });
        if (!initial) return { kind: "missing" as const };
        await lockBed(transaction, initial.bedId);
        const current = await transaction.tenancy.findUnique({ where: { id: tenancyId }, select: { bedId: true, status: true } });
        if (!current) return { kind: "missing" as const };
        if (current.status === "ENDED") {
          return { kind: "already-ended" as const, tenancy: await transaction.tenancy.findUnique({ where: { id: tenancyId }, select: tenancySelect }) };
        }
        if (current.status !== "ACTIVE") return { kind: "invalid" as const };
        const updated = await transaction.tenancy.updateMany({
          where: { id: tenancyId, status: "ACTIVE" }, data: { status: "ENDED", checkedOutAt },
        });
        if (updated.count !== 1) {
          const latest = await transaction.tenancy.findUnique({ where: { id: tenancyId }, select: { status: true } });
          if (latest?.status === "ENDED") return { kind: "already-ended" as const, tenancy: await transaction.tenancy.findUnique({ where: { id: tenancyId }, select: tenancySelect }) };
          return { kind: "invalid" as const };
        }
        return { kind: "ended" as const, tenancy: await transaction.tenancy.findUnique({ where: { id: tenancyId }, select: tenancySelect }) };
      });
    },
  };
}
