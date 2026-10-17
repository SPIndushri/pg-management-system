-- A tenancy created by check-in retains a unique link to its confirmed booking.
-- Nullable fields preserve compatibility with any legacy/manual tenancy rows.
ALTER TABLE "Tenancy"
    ADD COLUMN "bookingId" UUID,
    ADD COLUMN "checkedInAt" TIMESTAMPTZ(6),
    ADD COLUMN "checkedOutAt" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "Tenancy_bookingId_key" ON "Tenancy"("bookingId");

ALTER TABLE "Tenancy"
    ADD CONSTRAINT "Tenancy_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
