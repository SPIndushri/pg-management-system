import type { PrismaClient } from "@prisma/client";
import type { PropertyAccessRepository } from "../middleware/resource-authorization.js";

export function createPrismaResourceAccess(prisma: PrismaClient): PropertyAccessRepository & {
  findBookingAccess(bookingId: string): Promise<{ tenantId: string; propertyOwnerId: string } | null>;
  findTenancyAccess(tenancyId: string): Promise<{ tenantId: string; propertyOwnerId: string } | null>;
  findInvoiceAccess(invoiceId: string): Promise<{ tenantId: string; propertyOwnerId: string } | null>;
  findPaymentAccess(paymentId: string): Promise<{ tenantId: string; propertyOwnerId: string } | null>;
  findComplaintAccess(complaintId: string): Promise<{ tenantId: string; propertyOwnerId: string } | null>;
} {
  return {
    async findPropertyOwnerId(propertyId) {
      const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { ownerId: true } });
      return property?.ownerId ?? null;
    },
    async findBookingAccess(bookingId) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { tenantId: true, bed: { select: { room: { select: { property: { select: { ownerId: true } } } } } } },
      });
      return booking ? { tenantId: booking.tenantId, propertyOwnerId: booking.bed.room.property.ownerId } : null;
    },
    async findTenancyAccess(tenancyId) {
      const tenancy = await prisma.tenancy.findUnique({
        where: { id: tenancyId },
        select: { tenantId: true, bed: { select: { room: { select: { property: { select: { ownerId: true } } } } } } },
      });
      return tenancy ? { tenantId: tenancy.tenantId, propertyOwnerId: tenancy.bed.room.property.ownerId } : null;
    },
    async findInvoiceAccess(invoiceId) {
      const invoice = await prisma.rentInvoice.findUnique({
        where: { id: invoiceId },
        select: { tenancy: { select: { tenantId: true, bed: { select: { room: { select: { property: { select: { ownerId: true } } } } } } } } },
      });
      return invoice ? { tenantId: invoice.tenancy.tenantId, propertyOwnerId: invoice.tenancy.bed.room.property.ownerId } : null;
    },
    async findPaymentAccess(paymentId) {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: { invoice: { select: { tenancy: { select: { tenantId: true, bed: { select: { room: { select: { property: { select: { ownerId: true } } } } } } } } } } },
      });
      return payment ? {
        tenantId: payment.invoice.tenancy.tenantId,
        propertyOwnerId: payment.invoice.tenancy.bed.room.property.ownerId,
      } : null;
    },
    async findComplaintAccess(complaintId) {
      const complaint = await prisma.complaint.findUnique({
        where: { id: complaintId },
        select: { tenantId: true, property: { select: { ownerId: true } } },
      });
      return complaint ? { tenantId: complaint.tenantId, propertyOwnerId: complaint.property.ownerId } : null;
    },
  };
}
