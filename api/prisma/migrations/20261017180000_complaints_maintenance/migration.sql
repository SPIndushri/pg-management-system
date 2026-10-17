CREATE TYPE "ComplaintCategory" AS ENUM ('PLUMBING', 'ELECTRICAL', 'CLEANING', 'WIFI', 'FURNITURE', 'OTHER');
CREATE TYPE "ComplaintActivityType" AS ENUM ('CREATED', 'COMMENT', 'STATUS_CHANGE', 'PRIORITY_CHANGE');

ALTER TABLE "Complaint"
  ADD COLUMN "category" "ComplaintCategory" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "roomId" UUID,
  ADD COLUMN "bedId" UUID,
  ADD COLUMN "tenancyId" UUID,
  ADD COLUMN "resolutionNote" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMPTZ(6),
  ADD COLUMN "closedAt" TIMESTAMPTZ(6);

CREATE INDEX "Complaint_roomId_idx" ON "Complaint"("roomId");
CREATE INDEX "Complaint_bedId_idx" ON "Complaint"("bedId");
CREATE INDEX "Complaint_tenancyId_idx" ON "Complaint"("tenancyId");

CREATE TABLE "ComplaintActivity" (
  "id" UUID NOT NULL,
  "complaintId" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "type" "ComplaintActivityType" NOT NULL,
  "message" VARCHAR(2000),
  "fromStatus" "ComplaintStatus",
  "toStatus" "ComplaintStatus",
  "fromPriority" "ComplaintPriority",
  "toPriority" "ComplaintPriority",
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComplaintActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComplaintActivity_complaintId_createdAt_idx" ON "ComplaintActivity"("complaintId", "createdAt");
CREATE INDEX "ComplaintActivity_authorId_createdAt_idx" ON "ComplaintActivity"("authorId", "createdAt");

ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplaintActivity" ADD CONSTRAINT "ComplaintActivity_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplaintActivity" ADD CONSTRAINT "ComplaintActivity_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
