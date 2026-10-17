import type { BrowseQuery, BedInput, BedUpdate, PropertyInput, PropertyUpdate, RoomInput, RoomUpdate } from "./schemas.js";

export interface PropertyRepository {
  listManaged(ownerId: string | null): Promise<unknown>;
  createProperty(ownerId: string, input: PropertyInput): Promise<unknown>;
  getManaged(propertyId: string): Promise<unknown | null>;
  updateProperty(propertyId: string, input: PropertyUpdate): Promise<unknown | null>;
  deleteProperty(propertyId: string): Promise<"deleted" | "missing" | "in-use">;
  listRooms(propertyId: string): Promise<unknown | null>;
  createRoom(propertyId: string, input: RoomInput): Promise<unknown | null>;
  updateRoom(propertyId: string, roomId: string, input: RoomUpdate): Promise<unknown | null>;
  deleteRoom(propertyId: string, roomId: string): Promise<"deleted" | "missing" | "in-use">;
  listBeds(propertyId: string, roomId: string): Promise<unknown | null>;
  createBed(propertyId: string, roomId: string, input: BedInput): Promise<unknown | null>;
  updateBed(propertyId: string, roomId: string, bedId: string, input: BedUpdate): Promise<unknown | null>;
  deleteBed(propertyId: string, roomId: string, bedId: string): Promise<"deleted" | "missing" | "in-use">;
  browse(query: BrowseQuery): Promise<unknown>;
  publicDetail(propertyId: string, query: BrowseQuery): Promise<unknown | null>;
}

export class PropertyService {
  constructor(private readonly repository: PropertyRepository) {}
  managed(ownerId: string | null) { return this.repository.listManaged(ownerId); }
  create(ownerId: string, input: PropertyInput) { return this.repository.createProperty(ownerId, input); }
  get(propertyId: string) { return this.repository.getManaged(propertyId); }
  update(propertyId: string, input: PropertyUpdate) { return this.repository.updateProperty(propertyId, input); }
  remove(propertyId: string) { return this.repository.deleteProperty(propertyId); }
  rooms(propertyId: string) { return this.repository.listRooms(propertyId); }
  addRoom(propertyId: string, input: RoomInput) { return this.repository.createRoom(propertyId, input); }
  updateRoom(propertyId: string, roomId: string, input: RoomUpdate) { return this.repository.updateRoom(propertyId, roomId, input); }
  removeRoom(propertyId: string, roomId: string) { return this.repository.deleteRoom(propertyId, roomId); }
  beds(propertyId: string, roomId: string) { return this.repository.listBeds(propertyId, roomId); }
  addBed(propertyId: string, roomId: string, input: BedInput) { return this.repository.createBed(propertyId, roomId, input); }
  updateBed(propertyId: string, roomId: string, bedId: string, input: BedUpdate) { return this.repository.updateBed(propertyId, roomId, bedId, input); }
  removeBed(propertyId: string, roomId: string, bedId: string) { return this.repository.deleteBed(propertyId, roomId, bedId); }
  browse(query: BrowseQuery) { return this.repository.browse(query); }
  publicDetail(propertyId: string, query: BrowseQuery) { return this.repository.publicDetail(propertyId, query); }
}
