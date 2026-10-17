import { Prisma, type PrismaClient } from "@prisma/client";
import type { DashboardRepository } from "./service.js";

const bookingSelect = {
  id: true, startDate: true, endDate: true, status: true, createdAt: true,
  tenant: { select: { id: true, fullName: true } },
  bed: { select: { id: true, label: true, room: { select: { id: true, roomNumber: true, property: { select: { id: true, name: true, city: true } } } } } },
  tenancy: { select: { id: true, status: true } },
} satisfies Prisma.BookingSelect;
const tenancySelect = {
  id: true, status: true, startDate: true, endDate: true, checkedInAt: true, checkedOutAt: true,
  bed: { select: { id: true, label: true, room: { select: { id: true, roomNumber: true, property: { select: { id: true, name: true, city: true, region: true } } } } } },
} satisfies Prisma.TenancySelect;
const paymentSelect = {
  id: true, amount: true, currencyCode: true, method: true, reference: true, recordedAt: true,
  invoice: {
    select: {
      id: true, dueDate: true,
      tenancy: { select: { bed: { select: { label: true, room: { select: { roomNumber: true, property: { select: { name: true } } } } } } } },
    },
  },
} satisfies Prisma.PaymentSelect;
const complaintSelect = {
  id: true, title: true, category: true, priority: true, status: true, updatedAt: true,
  property: { select: { id: true, name: true } },
  activities: { orderBy: { createdAt: "desc" as const }, take: 2, select: { id: true, type: true, message: true, createdAt: true } },
} satisfies Prisma.ComplaintSelect;
type GroupCount<T extends string> = Record<T, number>;
const counts = <T extends string>(values: Array<{ status: T; _count: { _all: number } }>): GroupCount<T> => Object.fromEntries(values.map((v) => [v.status, v._count._all])) as GroupCount<T>;
const rangeWhere = (from: Date, toExclusive: Date) => ({ gte: from, lt: toExclusive });
const safeDecimal = (value: Prisma.Decimal) => value.toFixed(2);

async function ownerInvoiceSummary(prisma: PrismaClient, ownerId: string | null, asOf: Date, from: Date, toExclusive: Date) {
  const row = ownerId
    ? await prisma.$queryRaw<Array<{ currencyCode: string; invoiceAmount: string; outstanding: string; overdue: string; overdueCount: bigint }>>`
      SELECT i."currencyCode"::text AS "currencyCode",
        COALESCE(SUM(i."amount") FILTER (WHERE i."createdAt" >= ${from} AND i."createdAt" < ${toExclusive} AND i."status" NOT IN ('DRAFT','VOID')),0)::text AS "invoiceAmount",
        COALESCE(SUM(GREATEST(i."amount" - COALESCE(paid.total,0),0)),0)::text AS "outstanding",
        COALESCE(SUM(GREATEST(i."amount" - COALESCE(paid.total,0),0)) FILTER (WHERE i."dueDate" < ${asOf}::date AND GREATEST(i."amount" - COALESCE(paid.total,0),0) > 0),0)::text AS "overdue",
        COUNT(*) FILTER (WHERE i."dueDate" < ${asOf}::date AND GREATEST(i."amount" - COALESCE(paid.total,0),0) > 0) AS "overdueCount"
      FROM "RentInvoice" i JOIN "Tenancy" t ON t."id"=i."tenancyId" JOIN "Bed" b ON b."id"=t."bedId" JOIN "Room" r ON r."id"=b."roomId" JOIN "Property" prop ON prop."id"=r."propertyId"
      LEFT JOIN (SELECT "invoiceId", SUM("amount") AS total FROM "Payment" WHERE "status"='SUCCEEDED' GROUP BY "invoiceId") paid ON paid."invoiceId"=i."id"
      WHERE prop."ownerId"=${ownerId}::uuid AND i."status" NOT IN ('DRAFT','VOID') GROUP BY i."currencyCode"`
    : await prisma.$queryRaw<Array<{ currencyCode: string; invoiceAmount: string; outstanding: string; overdue: string; overdueCount: bigint }>>`
      SELECT i."currencyCode"::text AS "currencyCode",
        COALESCE(SUM(i."amount") FILTER (WHERE i."createdAt" >= ${from} AND i."createdAt" < ${toExclusive} AND i."status" NOT IN ('DRAFT','VOID')),0)::text AS "invoiceAmount",
        COALESCE(SUM(GREATEST(i."amount" - COALESCE(paid.total,0),0)),0)::text AS "outstanding",
        COALESCE(SUM(GREATEST(i."amount" - COALESCE(paid.total,0),0)) FILTER (WHERE i."dueDate" < ${asOf}::date AND GREATEST(i."amount" - COALESCE(paid.total,0),0) > 0),0)::text AS "overdue",
        COUNT(*) FILTER (WHERE i."dueDate" < ${asOf}::date AND GREATEST(i."amount" - COALESCE(paid.total,0),0) > 0) AS "overdueCount"
      FROM "RentInvoice" i JOIN "Tenancy" t ON t."id"=i."tenancyId" JOIN "Bed" b ON b."id"=t."bedId" JOIN "Room" r ON r."id"=b."roomId" JOIN "Property" prop ON prop."id"=r."propertyId"
      LEFT JOIN (SELECT "invoiceId", SUM("amount") AS total FROM "Payment" WHERE "status"='SUCCEEDED' GROUP BY "invoiceId") paid ON paid."invoiceId"=i."id"
      WHERE i."status" NOT IN ('DRAFT','VOID') GROUP BY i."currencyCode"`;
  return { byCurrency: row.map((item) => ({ currencyCode: item.currencyCode.trim(), invoiceAmountInRange: item.invoiceAmount, outstandingBalance: item.outstanding, overdueBalance: item.overdue, overdueInvoiceCount: Number(item.overdueCount) })), overdueInvoiceCount: row.reduce((sum, item) => sum + Number(item.overdueCount), 0) };
}

export function createPrismaDashboardRepository(prisma: PrismaClient): DashboardRepository {
  return {
    async owner(ownerId, range) {
      const propertyWhere: Prisma.PropertyWhereInput = ownerId ? { ownerId } : {};
      const bedWhere: Prisma.BedWhereInput = ownerId ? { room: { property: { ownerId } } } : {};
      const bookingScope: Prisma.BookingWhereInput = { ...(ownerId ? { bed: { room: { property: { ownerId } } } } : {}), createdAt: rangeWhere(range.from, range.toExclusive) };
      const tenancyScope: Prisma.TenancyWhereInput = ownerId ? { bed: { room: { property: { ownerId } } } } : {};
      const paymentScope: Prisma.PaymentWhereInput = { status: "SUCCEEDED", recordedAt: rangeWhere(range.from, range.toExclusive), ...(ownerId ? { invoice: { tenancy: { bed: { room: { property: { ownerId } } } } } } : {}) };
      const complaintScope: Prisma.ComplaintWhereInput = { status: { in: ["OPEN", "IN_PROGRESS"] }, ...(ownerId ? { property: { ownerId } } : {}) };
      const [properties, rooms, beds, bookingRows, tenancies, invoiceSummary, payments, collected, complaints, recentBookings, recentTenancies, recentComplaints] = await Promise.all([
        prisma.property.groupBy({ by: ["status"], where: propertyWhere, _count: { _all: true } }),
        prisma.room.count({ where: ownerId ? { property: { ownerId } } : {} }),
        prisma.bed.groupBy({ by: ["status"], where: bedWhere, _count: { _all: true } }),
        prisma.booking.groupBy({ by: ["status"], where: bookingScope, _count: { _all: true } }),
        prisma.tenancy.groupBy({ by: ["status"], where: tenancyScope, _count: { _all: true } }),
        ownerInvoiceSummary(prisma, ownerId, range.asOf, range.from, range.toExclusive),
        prisma.payment.findMany({ where: paymentScope, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 6, select: paymentSelect }),
        prisma.payment.groupBy({ by: ["currencyCode"], where: paymentScope, _sum: { amount: true } }),
        prisma.complaint.groupBy({ by: ["status"], where: complaintScope, _count: { _all: true } }),
        prisma.booking.findMany({ where: { ...bookingScope, status: "PENDING" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 6, select: bookingSelect }),
        prisma.tenancy.findMany({ where: tenancyScope, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 6, select: tenancySelect }),
        prisma.complaint.findMany({ where: complaintScope, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 6, select: complaintSelect }),
      ]);
      const propertyCounts = Object.fromEntries(properties.map((x) => [x.status, x._count._all]));
      const bedCounts = Object.fromEntries(beds.map((x) => [x.status, x._count._all]));
      return {
        range: { from: range.from.toISOString().slice(0, 10), to: new Date(range.toExclusive.getTime() - 86_400_000).toISOString().slice(0, 10) },
        properties: { total: Object.values(propertyCounts).reduce((a, b) => a + b, 0), byStatus: propertyCounts, rooms, beds: { total: Object.values(bedCounts).reduce((a, b) => a + b, 0), byStatus: bedCounts } },
        bookings: counts(bookingRows), tenancies: counts(tenancies), invoices: invoiceSummary,
        payments: { recordedAmountInRangeByCurrency: collected.map((item) => ({ currencyCode: item.currencyCode.trim(), amount: safeDecimal(item._sum.amount ?? new Prisma.Decimal(0)) })), recent: payments.map((p) => ({ ...p, amount: p.amount.toFixed(2), currencyCode: p.currencyCode.trim() })) },
        maintenance: counts(complaints), recentBookingRequests: recentBookings, recentTenancies, recentMaintenance: recentComplaints,
      };
    },

    async tenant(tenantId, range) {
      const [bookingRows, tenancies, tenancyCount, bookingRecent, invoiceRows, payments, complaints, maintenanceCount] = await Promise.all([
        prisma.booking.groupBy({ by: ["status"], where: { tenantId, createdAt: rangeWhere(range.from, range.toExclusive) }, _count: { _all: true } }),
        prisma.tenancy.findMany({ where: { tenantId, status: "ACTIVE" }, orderBy: [{ startDate: "desc" }, { id: "desc" }], take: 5, select: tenancySelect }),
        prisma.tenancy.count({ where: { tenantId, status: "ACTIVE" } }),
        prisma.booking.findMany({ where: { tenantId, createdAt: rangeWhere(range.from, range.toExclusive) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 6, select: bookingSelect }),
        prisma.rentInvoice.findMany({ where: { tenancy: { tenantId }, status: { in: ["ISSUED", "OVERDUE"] } }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], take: 6, select: { id: true, dueDate: true, periodStart: true, periodEnd: true, amount: true, currencyCode: true, status: true, tenancyId: true } }),
        prisma.payment.findMany({ where: { status: "SUCCEEDED", recordedAt: rangeWhere(range.from, range.toExclusive), invoice: { tenancy: { tenantId } } }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 6, select: paymentSelect }),
        prisma.complaint.findMany({ where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 6, select: complaintSelect }),
        prisma.complaint.count({ where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      ]);
      // Payment histories are aggregated only for the six displayed invoices.
      const invoicePaid = invoiceRows.length ? await prisma.payment.groupBy({ by: ["invoiceId"], where: { status: "SUCCEEDED", invoiceId: { in: invoiceRows.map((row) => row.id) } }, _sum: { amount: true } }) : [];
      const paidByInvoice = new Map(invoicePaid.map((row) => [row.invoiceId, row._sum.amount ?? new Prisma.Decimal(0)]));
      return {
        range: { from: range.from.toISOString().slice(0, 10), to: new Date(range.toExclusive.getTime() - 86_400_000).toISOString().slice(0, 10) },
        bookings: counts(bookingRows), recentBookings: bookingRecent,
        currentTenancies: { count: tenancyCount, items: tenancies },
        invoices: invoiceRows.map((invoice) => {
          const paid = paidByInvoice.get(invoice.id) ?? new Prisma.Decimal(0);
          const balance = Prisma.Decimal.max(new Prisma.Decimal(0), invoice.amount.minus(paid));
          const status = balance.isZero() ? "PAID" : invoice.dueDate < range.asOf ? "OVERDUE" : "ISSUED";
          return { ...invoice, status, amount: invoice.amount.toFixed(2), balanceDue: balance.toFixed(2), currencyCode: invoice.currencyCode.trim() };
        }),
        recentPayments: payments.map((p) => ({ ...p, amount: p.amount.toFixed(2), currencyCode: p.currencyCode.trim() })),
        maintenance: { openOrInProgressCount: maintenanceCount, items: complaints },
      };
    },
  };
}
