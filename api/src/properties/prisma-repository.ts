import type { Prisma, PrismaClient } from "@prisma/client";
import type { PropertyRepository } from "./service.js";
import type { BrowseQuery, BedInput, BedUpdate, PropertyInput, PropertyUpdate, RoomInput, RoomUpdate } from "./schemas.js";
import { isBedAvailable } from "./availability.js";

const publicSelect = { id: true, name: true, description: true, addressLine1: true, addressLine2: true, city: true, region: true, postalCode: true, countryCode: true, createdAt: true, updatedAt: true } as const;
const dateRange = (query: BrowseQuery) => {
  const start = query.startDate ? new Date(`${query.startDate}T00:00:00.000Z`) : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const end = query.endDate ? new Date(`${query.endDate}T00:00:00.000Z`) : new Date(start.getTime() + 86_400_000);
  return { start, end };
};
const overlap = (start: Date, end: Date) => ({ startDate: { lt: end }, OR: [{ endDate: null }, { endDate: { gt: start } }] });
const availabilityRooms = (start: Date, end: Date) => ({
  where: { status: "ACTIVE" as const }, orderBy: { roomNumber: "asc" as const },
    select: { id: true, roomNumber: true, floor: true, beds: {
    where: { status: "AVAILABLE" as const }, orderBy: { label: "asc" as const },
    select: { id: true, label: true, status: true,
      bookings: { where: { status: "CONFIRMED" as const, ...overlap(start, end) }, select: { status: true, startDate: true, endDate: true } },
      tenancies: { where: { status: "ACTIVE" as const, ...overlap(start, end) }, select: { status: true, startDate: true, endDate: true } },
    },
  } },
});

export function createPrismaPropertyRepository(prisma: PrismaClient): PropertyRepository {
  async function roomMatches(propertyId: string, roomId: string) {
    return Boolean(await prisma.room.findFirst({ where: { id: roomId, propertyId }, select: { id: true } }));
  }
  async function bedMatches(propertyId: string, roomId: string, bedId: string) {
    return Boolean(await prisma.bed.findFirst({ where: { id: bedId, roomId, room: { propertyId } }, select: { id: true } }));
  }
  async function hasActiveDependents(where: Prisma.BedWhereInput) {
    return Boolean(await prisma.bed.findFirst({ where: { ...where, OR: [
      { bookings: { some: { status: "CONFIRMED", OR: [{ endDate: null }, { endDate: { gt: new Date() } }] } } },
      { tenancies: { some: { status: "ACTIVE", OR: [{ endDate: null }, { endDate: { gt: new Date() } }] } } },
    ] }, select: { id: true } }));
  }
  return {
    async listManaged(ownerId) {
      return prisma.property.findMany({ where: ownerId ? { ownerId } : undefined, orderBy: { createdAt: "desc" } });
    },
    async createProperty(ownerId, input: PropertyInput) { return prisma.property.create({ data: { ...input, ownerId } }); },
    async getManaged(propertyId) { return prisma.property.findUnique({ where: { id: propertyId }, include: { rooms: { orderBy: { roomNumber: "asc" }, include: { beds: { orderBy: { label: "asc" } } } } } }); },
    async updateProperty(propertyId, input: PropertyUpdate) {
      if (input.status === "INACTIVE" && await hasActiveDependents({ room: { propertyId } })) throw Object.assign(new Error("Property has active bookings or tenancies."), { code: "RESOURCE_IN_USE" });
      return prisma.property.update({ where: { id: propertyId }, data: input });
    },
    async deleteProperty(propertyId) {
      const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } });
      if (!property) return "missing";
      if (await prisma.room.findFirst({ where: { propertyId }, select: { id: true } })) return "in-use";
      if (await prisma.complaint.findFirst({ where: { propertyId }, select: { id: true } })) return "in-use";
      await prisma.property.delete({ where: { id: propertyId } }); return "deleted";
    },
    async listRooms(propertyId) {
      if (!await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } })) return null;
      return prisma.room.findMany({ where: { propertyId }, orderBy: { roomNumber: "asc" }, include: { beds: { orderBy: { label: "asc" } } } });
    },
    async createRoom(propertyId, input: RoomInput) {
      if (!await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } })) return null;
      return prisma.room.create({ data: { ...input, propertyId } });
    },
    async updateRoom(propertyId, roomId, input: RoomUpdate) {
      if (!await roomMatches(propertyId, roomId)) return null;
      if (input.status === "INACTIVE" && await hasActiveDependents({ roomId })) throw Object.assign(new Error("Room has active bookings or tenancies."), { code: "RESOURCE_IN_USE" });
      return prisma.room.update({ where: { id: roomId }, data: input });
    },
    async deleteRoom(propertyId, roomId) {
      if (!await roomMatches(propertyId, roomId)) return "missing";
      if (await prisma.bed.findFirst({ where: { roomId }, select: { id: true } })) return "in-use";
      await prisma.room.delete({ where: { id: roomId } }); return "deleted";
    },
    async listBeds(propertyId, roomId) {
      if (!await roomMatches(propertyId, roomId)) return null;
      return prisma.bed.findMany({ where: { roomId }, orderBy: { label: "asc" } });
    },
    async createBed(propertyId, roomId, input: BedInput) {
      if (!await roomMatches(propertyId, roomId)) return null;
      return prisma.bed.create({ data: { ...input, roomId } });
    },
    async updateBed(propertyId, roomId, bedId, input: BedUpdate) {
      if (!await bedMatches(propertyId, roomId, bedId)) return null;
      if (input.status && input.status !== "AVAILABLE" && await hasActiveDependents({ id: bedId })) throw Object.assign(new Error("Bed has active bookings or tenancies."), { code: "RESOURCE_IN_USE" });
      return prisma.bed.update({ where: { id: bedId }, data: input });
    },
    async deleteBed(propertyId, roomId, bedId) {
      if (!await bedMatches(propertyId, roomId, bedId)) return "missing";
      if (await hasActiveDependents({ id: bedId })) return "in-use";
      if (await prisma.booking.findFirst({ where: { bedId }, select: { id: true } }) || await prisma.tenancy.findFirst({ where: { bedId }, select: { id: true } })) return "in-use";
      await prisma.bed.delete({ where: { id: bedId } }); return "deleted";
    },
    async browse(query) {
      const { start, end } = dateRange(query);
      const where: Prisma.PropertyWhereInput = { status: "ACTIVE", ...(query.city ? { city: { equals: query.city, mode: "insensitive" } } : {}), ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { city: { contains: query.search, mode: "insensitive" } }, { description: { contains: query.search, mode: "insensitive" } }] } : {}) };
      const [total, properties] = await Promise.all([
        prisma.property.count({ where }),
        prisma.property.findMany({ where, select: { ...publicSelect, rooms: availabilityRooms(start, end) }, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      ]);
      return { items: properties.map((p) => ({ ...p, rooms: p.rooms.map((r) => ({ ...r, beds: r.beds.map((b) => ({ id: b.id, label: b.label, isAvailable: isBedAvailable(b.status, b.bookings, b.tenancies, start, end) })) })) })), page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) };
    },
    async publicDetail(propertyId, query) {
      const { start, end } = dateRange(query);
      const p = await prisma.property.findFirst({ where: { id: propertyId, status: "ACTIVE" }, select: { ...publicSelect, rooms: availabilityRooms(start, end) } });
      if (!p) return null;
      return { ...p, rooms: p.rooms.map((r) => ({ ...r, beds: r.beds.map((b) => ({ id: b.id, label: b.label, isAvailable: isBedAvailable(b.status, b.bookings, b.tenancies, start, end) })) })) };
    },
  };
}
