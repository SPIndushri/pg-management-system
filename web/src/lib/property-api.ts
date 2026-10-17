export type PropertyStatus = "DRAFT" | "ACTIVE" | "INACTIVE";
export type RoomStatus = "ACTIVE" | "INACTIVE";
export type BedStatus = "AVAILABLE" | "MAINTENANCE" | "INACTIVE";
export interface Bed { id: string; label: string; status?: BedStatus; isAvailable?: boolean }
export interface Room { id: string; roomNumber: string; floor: number | null; status?: RoomStatus; beds?: Bed[] }
export interface Property { id: string; ownerId?: string; name: string; description?: string | null; addressLine1: string; addressLine2?: string | null; city: string; region: string; postalCode: string; countryCode: string; status?: PropertyStatus; rooms?: Room[] }
interface ErrorResponse { error?: { message?: string; issues?: Array<{ path: Array<string | number>; message: string }> } }
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");

export class PropertyApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "PropertyApiError"; }
}
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (method !== "GET" && method !== "HEAD") {
    const csrf = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("pg_csrf="));
    if (csrf) headers.set("X-CSRF-Token", decodeURIComponent(csrf.slice("pg_csrf=".length)));
  }
  const response = await fetch(`${apiBaseUrl}${path}`, { method, headers, credentials: "include", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as ErrorResponse;
    const issues = payload.error?.issues?.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · ");
    throw new PropertyApiError(issues || payload.error?.message || "The request could not be completed.", response.status);
  }
  return (response.status === 204 ? undefined : response.json()) as Promise<T>;
}
const qs = (input: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => value !== undefined && params.set(key, String(value)));
  return params.size ? `?${params.toString()}` : "";
};

export const propertyApi = {
  browse(input: { page?: number; pageSize?: number; city?: string; search?: string } = {}) { return api<{ items: Property[]; page: number; pageSize: number; total: number; totalPages: number }>(`/properties${qs(input)}`); },
  detail(id: string, dates: { startDate?: string; endDate?: string } = {}) { return api<{ property: Property }>(`/properties/${encodeURIComponent(id)}${qs(dates)}`); },
  managed() { return api<{ properties: Property[] }>("/owner/properties"); },
  managedProperty(id: string) { return api<{ property: Property }>(`/owner/properties/${encodeURIComponent(id)}`); },
  createProperty(input: Omit<Property, "id" | "ownerId" | "status" | "rooms">) { return api<{ property: Property }>("/owner/properties", "POST", input); },
  updateProperty(id: string, input: Partial<Property>) { return api<{ property: Property }>(`/owner/properties/${encodeURIComponent(id)}`, "PATCH", input); },
  deleteProperty(id: string) { return api<void>(`/owner/properties/${encodeURIComponent(id)}`, "DELETE"); },
  rooms(propertyId: string) { return api<{ rooms: Room[] }>(`/owner/properties/${encodeURIComponent(propertyId)}/rooms`); },
  addRoom(propertyId: string, input: { roomNumber: string; floor?: number | null }) { return api<{ room: Room }>(`/owner/properties/${encodeURIComponent(propertyId)}/rooms`, "POST", input); },
  updateRoom(propertyId: string, roomId: string, input: Partial<Room>) { return api<{ room: Room }>(`/owner/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}`, "PATCH", input); },
  deleteRoom(propertyId: string, roomId: string) { return api<void>(`/owner/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}`, "DELETE"); },
  beds(propertyId: string, roomId: string) { return api<{ beds: Bed[] }>(`/owner/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}/beds`); },
  addBed(propertyId: string, roomId: string, input: { label: string }) { return api<{ bed: Bed }>(`/owner/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}/beds`, "POST", input); },
  updateBed(propertyId: string, roomId: string, bedId: string, input: Partial<Bed>) { return api<{ bed: Bed }>(`/owner/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}/beds/${encodeURIComponent(bedId)}`, "PATCH", input); },
  deleteBed(propertyId: string, roomId: string, bedId: string) { return api<void>(`/owner/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}/beds/${encodeURIComponent(bedId)}`, "DELETE"); },
};
