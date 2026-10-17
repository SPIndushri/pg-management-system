import type { CreateComplaintInput, OwnerComplaintQuery, UpdateComplaintInput } from "./schemas.js";

export type ComplaintStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type ComplaintPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type ComplaintCategory = "PLUMBING" | "ELECTRICAL" | "CLEANING" | "WIFI" | "FURNITURE" | "OTHER";
export interface ComplaintRepository {
  createForTenant(tenantId: string, input: CreateComplaintInput, now: Date): Promise<{ kind: "created"; complaint: unknown } | { kind: "ineligible-tenancy" } | { kind: "missing-location" }>;
  listTenant(tenantId: string, status?: ComplaintStatus): Promise<unknown>;
  getTenant(complaintId: string, tenantId: string): Promise<unknown | null>;
  listOwner(ownerId: string | null, query: OwnerComplaintQuery): Promise<unknown>;
  getOwner(complaintId: string): Promise<unknown | null>;
  addActivity(complaintId: string, authorId: string, message: string): Promise<unknown | null>;
  updateOwner(complaintId: string, authorId: string, input: UpdateComplaintInput, now: Date): Promise<"updated" | "missing" | "invalid-transition" | "resolution-required">;
}
export class ComplaintWorkflowError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "ComplaintWorkflowError"; }
}
export class ComplaintService {
  constructor(private readonly repository: ComplaintRepository, private readonly now: () => Date = () => new Date()) {}
  async create(tenantId: string, input: CreateComplaintInput) {
    const result = await this.repository.createForTenant(tenantId, input, this.now());
    if (result.kind === "ineligible-tenancy") throw new ComplaintWorkflowError(409, "INELIGIBLE_TENANCY", "A current active tenancy is required to create a request.");
    if (result.kind === "missing-location") throw new ComplaintWorkflowError(400, "INVALID_LOCATION", "The selected room or bed does not belong to this tenancy.");
    return result.complaint;
  }
  listTenant(tenantId: string, status?: ComplaintStatus) { return this.repository.listTenant(tenantId, status); }
  getTenant(id: string, tenantId: string) { return this.repository.getTenant(id, tenantId); }
  listOwner(ownerId: string | null, query: OwnerComplaintQuery) { return this.repository.listOwner(ownerId, query); }
  getOwner(id: string) { return this.repository.getOwner(id); }
  addActivity(id: string, authorId: string, message: string) { return this.repository.addActivity(id, authorId, message); }
  async updateOwner(id: string, authorId: string, input: UpdateComplaintInput) {
    const result = await this.repository.updateOwner(id, authorId, input, this.now());
    if (result === "missing") throw new ComplaintWorkflowError(404, "NOT_FOUND", "Complaint not found.");
    if (result === "resolution-required") throw new ComplaintWorkflowError(400, "RESOLUTION_NOTE_REQUIRED", "Add a resolution note when resolving a request.");
    if (result === "invalid-transition") throw new ComplaintWorkflowError(409, "INVALID_TRANSITION", "This request cannot make that status transition.");
  }
}
