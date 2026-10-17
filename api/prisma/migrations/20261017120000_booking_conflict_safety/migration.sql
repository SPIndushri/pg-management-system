-- Booking ranges are half-open, matching the existing tenancy convention.
-- A NULL upper date is represented as an unbounded daterange, preserving the
-- current schema's nullable endDate while API-created bookings require an end.
ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_valid_date_range"
    CHECK ("endDate" IS NULL OR "endDate" > "startDate");

-- Pending requests do not reserve a bed. Once confirmed, PostgreSQL prevents
-- overlapping confirmed bookings for the same bed, including concurrent writes.
ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_no_overlapping_confirmed_bed_periods"
    EXCLUDE USING GIST (
        "bedId" WITH =,
        daterange("startDate", "endDate", '[)') WITH &&
    )
    WHERE ("status" = 'CONFIRMED');
