CREATE TYPE "ManualPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'CHEQUE', 'OTHER');

ALTER TABLE "Payment"
    ADD COLUMN "method" "ManualPaymentMethod" NOT NULL DEFAULT 'OTHER',
    ADD COLUMN "reference" VARCHAR(200),
    ADD COLUMN "idempotencyKey" UUID;

CREATE UNIQUE INDEX "Payment_invoiceId_idempotencyKey_key"
    ON "Payment"("invoiceId", "idempotencyKey");

ALTER TABLE "RentInvoice"
    ADD CONSTRAINT "RentInvoice_valid_period" CHECK ("periodEnd" > "periodStart"),
    ADD CONSTRAINT "RentInvoice_positive_amount" CHECK ("amount" > 0);

ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_positive_amount" CHECK ("amount" > 0);
