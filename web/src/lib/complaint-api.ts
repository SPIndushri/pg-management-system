export type ComplaintStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type ComplaintPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type ComplaintCategory = "PLUMBING" | "ELECTRICAL" | "CLEANING" | "WIFI" | "FURNITURE" | "OTHER";
export interface ComplaintActivity {
  id: string; type: string; message: string | null; fromStatus: ComplaintStatus | null; toStatus: ComplaintStatus | null;
  fromPriority: ComplaintPriority | null; toPriority: ComplaintPriority | null; createdAt: string;
  author: { id: string; fullName: string; role: string };
}
export interface Complaint {
  id: string; title: string; description: string; category: ComplaintCategory; priority: ComplaintPriority; status: ComplaintStatus;
  resolutionNote: string | null; resolvedAt: string | null; closedAt: string | null; createdAt: string; updatedAt: string;
  tenant: { id: string; fullName: string }; property: { id: string; name: string; city: string; region: string };
  room: { id: string; roomNumber: string } | null; bed: { id: string; label: string } | null; activities: ComplaintActivity[];
}
interface ApiError { error?: { message?: string; issues?: Array<{ path: Array<string | number>; message: string }> } }
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");
export class ComplaintApiError extends Error { constructor(message: string, readonly status: number) { super(message); this.name = "ComplaintApiError"; } }
async function call<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const headers = new Headers();
  const options: RequestInit = { method, headers, credentials: "include" };
  if (method !== "GET") {
    const csrf = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("pg_csrf="));
    if (csrf) headers.set("X-CSRF-Token", decodeURIComponent(csrf.slice("pg_csrf=".length)));
    headers.set("Content-Type", "application/json"); options.body = JSON.stringify(payload ?? {});
  }
  const response = await fetch(`${baseUrl}${path}`, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as ApiError;
    const issues = data.error?.issues?.map((item) => `${item.path.join(".")}: ${item.message}`).join(" · ");
    throw new ComplaintApiError(issues || data.error?.message || "The request could not be completed.", response.status);
  }
  return response.json() as Promise<T>;
}
export const complaintApi = {
  tenantList: () => call<{ complaints: Complaint[] }>("/complaints"),
  create: (input: { tenancyId: string; roomId?: string; bedId?: string; title: string; description: string; category: ComplaintCategory }) => call<{ complaint: Complaint }>("/complaints", "POST", input),
  tenantComment: (id: string, message: string) => call<{ complaint: Complaint }>(`/complaints/${encodeURIComponent(id)}/activities`, "POST", { message }),
  ownerList: (filters: { status?: ComplaintStatus; priority?: ComplaintPriority } = {}) => {
    const params = new URLSearchParams(); if (filters.status) params.set("status", filters.status); if (filters.priority) params.set("priority", filters.priority);
    return call<{ complaints: Complaint[] }>(`/owner/complaints${params.size ? `?${params}` : ""}`);
  },
  update: (id: string, input: { status?: ComplaintStatus; priority?: ComplaintPriority; resolutionNote?: string; note?: string }) => call<{ complaint: Complaint }>(`/owner/complaints/${encodeURIComponent(id)}`, "PATCH", input),
  ownerComment: (id: string, message: string) => call<{ complaint: Complaint }>(`/owner/complaints/${encodeURIComponent(id)}/activities`, "POST", { message }),
};
