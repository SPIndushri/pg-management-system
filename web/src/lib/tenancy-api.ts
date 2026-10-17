export type TenancyStatus = "ACTIVE" | "ENDED" | "CANCELLED";
export interface Tenancy {
  id: string; bookingId: string | null; tenantId: string; bedId: string;
  startDate: string; endDate: string | null; status: TenancyStatus;
  checkedInAt: string | null; checkedOutAt: string | null;
  tenant: { id: string; fullName: string; email: string };
  bed: { id: string; label: string; room: { id: string; roomNumber: string; property: { id: string; name: string; city: string; region: string } } };
}
interface ApiError { error?: { message?: string; issues?: Array<{ path: Array<string | number>; message: string }> } }
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");
export class TenancyApiError extends Error { constructor(message: string, readonly status: number) { super(message); this.name = "TenancyApiError"; } }
async function call<T>(path: string, method = "GET"): Promise<T> {
  const headers = new Headers();
  if (method !== "GET") {
    const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("pg_csrf="));
    if (value) headers.set("X-CSRF-Token", decodeURIComponent(value.slice("pg_csrf=".length)));
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, credentials: "include", ...(method === "GET" ? {} : { body: "{}" }) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as ApiError;
    const validation = payload.error?.issues?.map((item) => `${item.path.join(".")}: ${item.message}`).join(" · ");
    throw new TenancyApiError(validation || payload.error?.message || "The tenancy request could not be completed.", response.status);
  }
  return response.json() as Promise<T>;
}
export const tenancyApi = {
  tenantList: () => call<{ tenancies: Tenancy[] }>("/tenancies"),
  ownerList: () => call<{ tenancies: Tenancy[] }>("/owner/tenancies"),
  checkIn: (bookingId: string) => call<{ tenancy: Tenancy; repeated: boolean }>(`/owner/bookings/${encodeURIComponent(bookingId)}/check-in`, "POST"),
  checkOut: (tenancyId: string) => call<{ tenancy: Tenancy; repeated: boolean }>(`/owner/tenancies/${encodeURIComponent(tenancyId)}/check-out`, "POST"),
};
