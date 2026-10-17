import { z } from "zod";

const uuid = z.string().uuid();
const message = z.string().trim().min(1).max(2000);
export const categorySchema = z.enum(["PLUMBING", "ELECTRICAL", "CLEANING", "WIFI", "FURNITURE", "OTHER"]);
export const statusSchema = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
export const prioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

export const createComplaintSchema = z.object({
  tenancyId: uuid,
  roomId: uuid.optional(),
  bedId: uuid.optional(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(10000),
  category: categorySchema,
}).strict();
export const tenantListQuerySchema = z.object({ status: statusSchema.optional() }).strict();
export const ownerListQuerySchema = z.object({
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  propertyId: uuid.optional(),
}).strict();
export const complaintIdSchema = z.object({ complaintId: uuid });
export const activitySchema = z.object({ message }).strict();
export const updateComplaintSchema = z.object({
  status: statusSchema.optional(), priority: prioritySchema.optional(),
  resolutionNote: z.string().trim().min(1).max(5000).optional(),
  note: message.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one update.");

export type CreateComplaintInput = z.infer<typeof createComplaintSchema>;
export type OwnerComplaintQuery = z.infer<typeof ownerListQuerySchema>;
export type UpdateComplaintInput = z.infer<typeof updateComplaintSchema>;
