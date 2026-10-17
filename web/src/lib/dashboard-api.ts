import type { Booking, BookingStatus } from "./booking-api";
import type { Complaint, ComplaintStatus } from "./complaint-api";
import type { RentInvoice, RecordedPayment } from "./billing-api";
import type { Tenancy } from "./tenancy-api";

interface ApiError { error?: { message?: string; issues?: Array<{ path: Array<string | number>; message: string }> } }
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");
export class DashboardApiError extends Error { constructor(message: string, readonly status: number) { super(message); this.name = "DashboardApiError"; } }
export interface DateRange { from: string; to: string }
type DashboardPayment = Pick<RecordedPayment, "id" | "amount" | "currencyCode" | "method" | "reference" | "recordedAt"> & {
  invoice: { id: string; dueDate: string; tenancy: { bed: { label: string; room: { roomNumber: string; property: { name: string } } } } };
};
export interface OwnerDashboardData {
  range: DateRange;
  properties: { total: number; byStatus: Record<string, number>; rooms: number; beds: { total: number; byStatus: Record<string, number> } };
  bookings: Partial<Record<BookingStatus, number>>;
  tenancies: Partial<Record<Tenancy["status"], number>>;
  invoices: { byCurrency: Array<{ currencyCode: string; invoiceAmountInRange: string; outstandingBalance: string; overdueBalance: string; overdueInvoiceCount: number }>; overdueInvoiceCount: number };
  payments: { recordedAmountInRangeByCurrency: Array<{ currencyCode: string; amount: string }>; recent: DashboardPayment[] };
  maintenance: Partial<Record<ComplaintStatus, number>>;
  recentBookingRequests: Booking[];
  recentTenancies: Tenancy[];
  recentMaintenance: Complaint[];
}
export interface TenantDashboardData {
  range: DateRange;
  bookings: Partial<Record<BookingStatus, number>>;
  recentBookings: Booking[];
  currentTenancies: { count: number; items: Tenancy[] };
  invoices: Array<Pick<RentInvoice, "id" | "dueDate" | "periodStart" | "periodEnd" | "amount" | "currencyCode" | "status" | "balanceDue" | "tenancyId">>;
  recentPayments: DashboardPayment[];
  maintenance: { openOrInProgressCount: number; items: Complaint[] };
}
async function call<T>(range: DateRange): Promise<T> {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  const response = await fetch(`${baseUrl}/dashboard?${query}`, { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as ApiError;
    const issues = data.error?.issues?.map((item) => `${item.path.join(".")}: ${item.message}`).join(" · ");
    throw new DashboardApiError(issues || data.error?.message || "Could not load dashboard data.", response.status);
  }
  return response.json() as Promise<T>;
}
export const dashboardApi = {
  owner: (range: DateRange) => call<{ role: "OWNER" | "ADMIN"; dashboard: OwnerDashboardData }>(range),
  tenant: (range: DateRange) => call<{ role: "TENANT"; dashboard: TenantDashboardData }>(range),
};
