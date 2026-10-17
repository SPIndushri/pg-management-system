export type TenancyStatus = "ACTIVE" | "ENDED" | "CANCELLED";
export type ConvertResult = "created" | "existing" | "missing" | "invalid" | "too-early" | "conflict";
export type EndResult = "ended" | "already-ended" | "missing" | "invalid";

export interface TenancyRepository {
  convertConfirmedBooking(bookingId: string, today: Date, checkedInAt: Date): Promise<{ kind: ConvertResult; tenancy?: unknown }>;
  listTenant(tenantId: string): Promise<unknown>;
  findTenant(tenancyId: string, tenantId: string): Promise<unknown | null>;
  listOwner(ownerId: string | null): Promise<unknown>;
  findOwner(tenancyId: string): Promise<unknown | null>;
  checkOut(tenancyId: string, checkedOutAt: Date): Promise<{ kind: EndResult; tenancy?: unknown }>;
}

export class TenancyWorkflowError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "TenancyWorkflowError"; }
}

const utcDay = (date: Date) => new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`);

export class TenancyService {
  constructor(private readonly repository: TenancyRepository, private readonly now: () => Date = () => new Date()) {}

  async checkInFromBooking(bookingId: string) {
    const checkedInAt = this.now();
    const result = await this.repository.convertConfirmedBooking(bookingId, utcDay(checkedInAt), checkedInAt);
    if (result.kind === "missing") throw new TenancyWorkflowError(404, "NOT_FOUND", "Booking not found.");
    if (result.kind === "invalid") throw new TenancyWorkflowError(409, "INVALID_TRANSITION", "Only a confirmed booking with a valid end date can be checked in.");
    if (result.kind === "too-early") throw new TenancyWorkflowError(409, "CHECK_IN_TOO_EARLY", "Check-in is available on or after the booking start date.");
    if (result.kind === "conflict") throw new TenancyWorkflowError(409, "TENANCY_CONFLICT", "The bed has a conflicting confirmed booking or active tenancy.");
    return { tenancy: result.tenancy, repeated: result.kind === "existing" };
  }

  tenantList(tenantId: string) { return this.repository.listTenant(tenantId); }
  tenantDetail(tenancyId: string, tenantId: string) { return this.repository.findTenant(tenancyId, tenantId); }
  ownerList(ownerId: string | null) { return this.repository.listOwner(ownerId); }
  ownerDetail(tenancyId: string) { return this.repository.findOwner(tenancyId); }

  async checkOut(tenancyId: string) {
    const result = await this.repository.checkOut(tenancyId, this.now());
    if (result.kind === "missing") throw new TenancyWorkflowError(404, "NOT_FOUND", "Tenancy not found.");
    if (result.kind === "invalid") throw new TenancyWorkflowError(409, "INVALID_TRANSITION", "Only an active tenancy can be checked out.");
    return { tenancy: result.tenancy, repeated: result.kind === "already-ended" };
  }
}
