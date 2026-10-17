export type BookingStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED";
export interface Booking {
  id: string; tenantId: string; bedId: string; startDate: string; endDate: string | null; status: BookingStatus; createdAt: string; updatedAt: string;
  tenant?: { id: string; fullName: string; email: string };
  tenancy?: { id: string; status: "ACTIVE" | "ENDED" | "CANCELLED" } | null;
  bed: { id: string; label: string; room: { id: string; roomNumber: string; property: { id: string; name: string; city: string; region: string } } };
}
interface ApiError { error?: { message?: string; issues?: Array<{ path: Array<string | number>; message: string }> } }
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");
export class BookingApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "BookingApiError"; }
}
async function call<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const headers = new Headers();
  if (data !== undefined) headers.set("Content-Type", "application/json");
  if (method !== "GET") {
    const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("pg_csrf="));
    if (value) headers.set("X-CSRF-Token", decodeURIComponent(value.slice("pg_csrf=".length)));
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, credentials: "include", ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as ApiError;
    const validation = payload.error?.issues?.map((item) => `${item.path.join(".")}: ${item.message}`).join(" · ");
    throw new BookingApiError(validation || payload.error?.message || "The booking request could not be completed.", response.status);
  }
  return (response.status === 204 ? undefined : response.json()) as Promise<T>;
}
export const bookingApi = {
  request(input: { bedId: string; startDate: string; endDate: string }) { return call<{ booking: Booking }>("/bookings", "POST", input); },
  tenantList() { return call<{ bookings: Booking[] }>("/bookings"); },
  tenantDetail(id: string) { return call<{ booking: Booking }>(`/bookings/${encodeURIComponent(id)}`); },
  cancelTenant(id: string) { return call<{ booking: { id: string; status: BookingStatus } }>(`/bookings/${encodeURIComponent(id)}/cancel`, "POST"); },
  ownerList(status?: BookingStatus) { return call<{ bookings: Booking[] }>(`/owner/bookings${status ? `?status=${status}` : ""}`); },
  approve(id: string) { return call<{ booking: { id: string; status: BookingStatus } }>(`/owner/bookings/${encodeURIComponent(id)}/approve`, "POST"); },
  reject(id: string) { return call<{ booking: { id: string; status: BookingStatus } }>(`/owner/bookings/${encodeURIComponent(id)}/reject`, "POST"); },
  cancelOwner(id: string) { return call<{ booking: { id: string; status: BookingStatus } }>(`/owner/bookings/${encodeURIComponent(id)}/cancel`, "POST"); },
};
