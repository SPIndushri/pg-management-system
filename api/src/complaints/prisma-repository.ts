import type { Prisma, PrismaClient } from "@prisma/client";
import type { ComplaintRepository } from "./service.js";
import type { CreateComplaintInput, OwnerComplaintQuery, UpdateComplaintInput } from "./schemas.js";

const selection = {
  id: true, tenantId: true, propertyId: true, tenancyId: true, roomId: true, bedId: true,
  title: true, description: true, category: true, priority: true, status: true,
  resolutionNote: true, resolvedAt: true, closedAt: true, createdAt: true, updatedAt: true,
  tenant: { select: { id: true, fullName: true } },
  property: { select: { id: true, name: true, city: true, region: true } },
  room: { select: { id: true, roomNumber: true } },
  bed: { select: { id: true, label: true } },
  activities: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], select: { id: true, type: true, message: true, fromStatus: true, toStatus: true, fromPriority: true, toPriority: true, createdAt: true, author: { select: { id: true, fullName: true, role: true } } } },
} satisfies Prisma.ComplaintSelect;
const todayUtc = (now: Date) => new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
const transitions: Record<string, string[]> = { OPEN: ["IN_PROGRESS"], IN_PROGRESS: ["RESOLVED"], RESOLVED: ["IN_PROGRESS", "CLOSED"], CLOSED: [] };

export function createPrismaComplaintRepository(prisma: PrismaClient): ComplaintRepository {
  return {
    async createForTenant(tenantId: string, input: CreateComplaintInput, now: Date) {
      return prisma.$transaction(async (tx) => {
        // Share-lock against checkout/status changes until the complaint and its audit row are committed.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Tenancy" WHERE "id" = ${input.tenancyId}::uuid FOR SHARE`;
        if (locked.length === 0) return { kind: "ineligible-tenancy" as const };
        const tenancy = await tx.tenancy.findFirst({
          where: { id: input.tenancyId, tenantId, status: "ACTIVE", startDate: { lte: todayUtc(now) }, OR: [{ endDate: null }, { endDate: { gt: todayUtc(now) } }] },
          select: { id: true, bed: { select: { id: true, roomId: true, room: { select: { propertyId: true } } } } },
        });
        if (!tenancy) return { kind: "ineligible-tenancy" as const };
        if ((input.roomId && input.roomId !== tenancy.bed.roomId) || (input.bedId && input.bedId !== tenancy.bed.id)) return { kind: "missing-location" as const };
        const complaint = await tx.complaint.create({
          data: { tenantId, propertyId: tenancy.bed.room.propertyId, tenancyId: tenancy.id, roomId: input.roomId ?? null, bedId: input.bedId ?? null, title: input.title, description: input.description, category: input.category,
            activities: { create: { authorId: tenantId, type: "CREATED", message: "Request created." } } },
          select: { id: true },
        });
        const full = await tx.complaint.findUnique({ where: { id: complaint.id }, select: selection });
        return { kind: "created" as const, complaint: full };
      });
    },
    async listTenant(tenantId, status) {
      return prisma.complaint.findMany({ where: { tenantId, ...(status ? { status } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: selection });
    },
    getTenant(complaintId, tenantId) { return prisma.complaint.findFirst({ where: { id: complaintId, tenantId }, select: selection }); },
    async listOwner(ownerId, query: OwnerComplaintQuery) {
      return prisma.complaint.findMany({ where: { ...(query.status ? { status: query.status } : {}), ...(query.priority ? { priority: query.priority } : {}), ...(query.propertyId ? { propertyId: query.propertyId } : {}), ...(ownerId ? { property: { ownerId } } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: selection });
    },
    getOwner(complaintId) { return prisma.complaint.findUnique({ where: { id: complaintId }, select: selection }); },
    async addActivity(complaintId, authorId, message) {
      const row = await prisma.complaint.findUnique({ where: { id: complaintId }, select: { id: true } });
      if (!row) return null;
      await prisma.complaintActivity.create({ data: { complaintId, authorId, type: "COMMENT", message } });
      return prisma.complaint.findUnique({ where: { id: complaintId }, select: selection });
    },
    async updateOwner(complaintId, authorId, input: UpdateComplaintInput, now: Date) {
      return prisma.$transaction(async (tx) => {
        // Serialize concurrent status/priority updates so both the transition check and audit rows use current state.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Complaint" WHERE "id" = ${complaintId}::uuid FOR UPDATE`;
        if (locked.length === 0) return "missing";
        const current = await tx.complaint.findUnique({ where: { id: complaintId }, select: { id: true, status: true, priority: true } });
        if (!current) return "missing";
        if (current.status === "CLOSED" && ((input.status && input.status !== current.status) || (input.priority && input.priority !== current.priority))) return "invalid-transition";
        if (input.status && input.status !== current.status && !transitions[current.status].includes(input.status)) return "invalid-transition";
        if (input.status === "RESOLVED" && current.status !== "RESOLVED" && !input.resolutionNote) return "resolution-required";
        if (input.status === current.status && input.status !== "RESOLVED" && input.resolutionNote) return "invalid-transition";
        if (input.status === "RESOLVED" && current.status === "RESOLVED" && input.resolutionNote) return "invalid-transition";
        const data: Prisma.ComplaintUpdateInput = {};
        if (input.status && input.status !== current.status) {
          data.status = input.status;
          data.resolvedAt = input.status === "RESOLVED" ? now : input.status === "IN_PROGRESS" ? null : undefined;
          data.closedAt = input.status === "CLOSED" ? now : undefined;
          data.resolutionNote = input.status === "RESOLVED" ? input.resolutionNote : input.status === "IN_PROGRESS" ? null : undefined;
        }
        if (input.priority && input.priority !== current.priority) data.priority = input.priority;
        if (input.resolutionNote && input.status === "RESOLVED") data.resolutionNote = input.resolutionNote;
        await tx.complaint.update({ where: { id: complaintId }, data });
        if (input.status && input.status !== current.status) await tx.complaintActivity.create({ data: { complaintId, authorId, type: "STATUS_CHANGE", fromStatus: current.status, toStatus: input.status, message: input.resolutionNote ?? input.note ?? null } });
        if (input.priority && input.priority !== current.priority) await tx.complaintActivity.create({ data: { complaintId, authorId, type: "PRIORITY_CHANGE", fromPriority: current.priority, toPriority: input.priority } });
        if (input.note) await tx.complaintActivity.create({ data: { complaintId, authorId, type: "COMMENT", message: input.note } });
        return "updated";
      });
    },
  };
}
