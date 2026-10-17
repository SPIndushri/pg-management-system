import type { BookingStatus } from "@prisma/client";
import type { CreateBookingInput, OwnerBookingQuery } from "./schemas.js";

export type BookingMutationResult = "ok" | "missing" | "invalid-transition" | "conflict" | "expired";
export interface BookingRecord {
  id: string;
  tenantId: string;
  bedId: string;
  startDate: Date;
  endDate: Date | null;
  status: BookingStatus;
}
export interface BookingRepository {
  createPending(tenantId: string, input: CreateBookingInput): Promise<{ kind: "created"; booking: unknown } | { kind: "missing-bed" } | { kind: "conflict" }>;
  listTenant(tenantId: string): Promise<unknown>;
  findTenantBooking(bookingId: string, tenantId: string): Promise<unknown | null>;
  listOwner(ownerId: string | null, query: OwnerBookingQuery): Promise<unknown>;
  findOwnerBooking(bookingId: string): Promise<unknown | null>;
  findBooking(bookingId: string): Promise<BookingRecord | null>;
  approvePending(bookingId: string, today: Date): Promise<BookingMutationResult>;
  rejectPending(bookingId: string): Promise<BookingMutationResult>;
  cancelBooking(bookingId: string, expectedStatus: BookingStatus): Promise<BookingMutationResult>;
}

export class BookingWorkflowError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "BookingWorkflowError"; }
}
const todayUtc = (now: Date) => new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);

export class BookingService {
  constructor(private readonly repository: BookingRepository, private readonly now: () => Date = () => new Date()) {}

  async request(tenantId: string, input: CreateBookingInput) {
    const today = todayUtc(this.now());
    const start = new Date(`${input.startDate}T00:00:00.000Z`);
    if (start < today) throw new BookingWorkflowError(400, "INVALID_DATE_RANGE", "Start date cannot be in the past.");
    const result = await this.repository.createPending(tenantId, input);
    if (result.kind === "missing-bed") throw new BookingWorkflowError(404, "RESOURCE_NOT_FOUND", "The selected bed is not available for booking.");
    if (result.kind === "conflict") throw new BookingWorkflowError(409, "BOOKING_CONFLICT", "The bed is not available for those dates.");
    return result.booking;
  }

  tenantBookings(tenantId: string) { return this.repository.listTenant(tenantId); }
  tenantBooking(bookingId: string, tenantId: string) { return this.repository.findTenantBooking(bookingId, tenantId); }
  ownerBookings(ownerId: string | null, query: OwnerBookingQuery) { return this.repository.listOwner(ownerId, query); }
  ownerBooking(bookingId: string) { return this.repository.findOwnerBooking(bookingId); }

  async approve(bookingId: string) {
    const result = await this.repository.approvePending(bookingId, todayUtc(this.now()));
    this.assertMutation(result, "Only a pending booking with a future start date can be approved.");
  }

  async reject(bookingId: string) {
    const result = await this.repository.rejectPending(bookingId);
    this.assertMutation(result, "Only a pending booking can be rejected.");
  }

  async cancelAsTenant(bookingId: string, tenantId: string) {
    const booking = await this.repository.findBooking(bookingId);
    if (!booking || booking.tenantId !== tenantId) throw new BookingWorkflowError(404, "NOT_FOUND", "Booking not found.");
    const today = todayUtc(this.now());
    const permitted = booking.status === "PENDING" || (booking.status === "CONFIRMED" && booking.startDate > today);
    if (!permitted) throw new BookingWorkflowError(409, "INVALID_TRANSITION", "This booking can no longer be cancelled.");
    const result = await this.repository.cancelBooking(bookingId, booking.status);
    this.assertMutation(result, "This booking can no longer be cancelled.");
  }

  async cancelAsOwner(bookingId: string) {
    const booking = await this.repository.findBooking(bookingId);
    if (!booking) throw new BookingWorkflowError(404, "NOT_FOUND", "Booking not found.");
    if (booking.status !== "CONFIRMED" || booking.startDate <= todayUtc(this.now())) {
      throw new BookingWorkflowError(409, "INVALID_TRANSITION", "Owners can cancel only confirmed bookings before the stay begins.");
    }
    const result = await this.repository.cancelBooking(bookingId, "CONFIRMED");
    this.assertMutation(result, "This booking can no longer be cancelled.");
  }

  private assertMutation(result: BookingMutationResult, transitionMessage: string): void {
    if (result === "ok") return;
    if (result === "missing") throw new BookingWorkflowError(404, "NOT_FOUND", "Booking not found.");
    if (result === "conflict") throw new BookingWorkflowError(409, "BOOKING_CONFLICT", "The bed has a conflicting confirmed booking or active tenancy.");
    if (result === "expired") throw new BookingWorkflowError(409, "BOOKING_EXPIRED", "The booking start date has passed and it can no longer be approved.");
    throw new BookingWorkflowError(409, "INVALID_TRANSITION", transitionMessage);
  }
}
