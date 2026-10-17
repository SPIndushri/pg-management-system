# PG Management System

A portfolio project for managing paying guest accommodations. The web app and future Android app will use the same REST API and PostgreSQL database.

## Project status

Phases 1 and 2 provide the web/API foundations and initial PostgreSQL schema. Phase 3 adds registration, login, cookie-backed sessions, logout, current-user lookup, validation, rate limiting, and reusable authorization middleware. Phase 4A adds property, room and bed management plus public property browsing. Phase 4B adds tenant booking requests and owner decisions. Phase 4C adds booking check-in and tenancy lifecycle features. Phase 4D adds rent invoices and manually recorded payments; gateway integration, complaints, notifications, and Flutter remain deferred.

## Prerequisites

- Node.js 20.19+ (Node.js 24 LTS recommended) and npm
- PostgreSQL 14+ running locally or a reachable PostgreSQL database
- Flutter SDK and Android toolchain are needed when mobile development begins

Check your local tools in PowerShell:

```powershell
node --version
npm --version
psql --version
flutter --version
```

## Setup

From the repository root in PowerShell:

```powershell
if (-not (Test-Path .env)) { 'VITE_API_BASE_URL=http://localhost:4000/api/v1' | Set-Content .env }
if (-not (Test-Path api/.env)) { Copy-Item .env.example api/.env }
# Ensure api/.env has the PostgreSQL DATABASE_URL and WEB_ORIGIN=http://localhost:5173.
npm install
npm run db:generate
npm run db:migrate
npm test
npm run build
```

Prisma CLI and the API load `api/.env` because npm runs those workspace commands from `api/`. Vite loads the repository-root `.env` (`web/vite.config.ts` sets `envDir: ".."`). Keep `DATABASE_URL` only in `api/.env`; the root `.env` needs only the public `VITE_API_BASE_URL` setting. Do not commit either `.env` file.

After entering your password in `api/.env`, verify the connection without applying migrations:

```powershell
Push-Location api
"SELECT current_database();" | npx prisma db execute --stdin --schema=prisma/schema.prisma
Pop-Location
```

Prisma schema and migrations live under `api/prisma/`. The root `db:generate` and `db:migrate` scripts run their Prisma commands in the `api` workspace, so they use `api/prisma/schema.prisma` and load `api/.env`. The initial migration creates the domain tables and the PostgreSQL `btree_gist` extension used by the tenancy overlap constraint. The database role must be allowed to create that extension.

For later schema changes, create a migration for review before applying it:

```powershell
npm run db:migrate -- --create-only --name describe_change
# Review api/prisma/migrations/<timestamp>_describe_change/migration.sql
npm run db:migrate
```

The tenancy overlap exclusion constraint is intentionally SQL in the initial migration because Prisma schema syntax does not model PostgreSQL exclusion constraints. Preserve that SQL constraint in future migrations.

After installing PostgreSQL and starting its Windows service, create the local database:

```powershell
psql -U postgres -c "CREATE DATABASE pg_management;"
```

The template uses the `postgres` role shown in the sample connection string. If your SQL Shell uses a different role, change the username in `api/.env`. URL-encode special characters in the password before placing it in the connection URL.

## Run the applications

Run API and web dev servers together:

```powershell
npm run dev
```

Or run them separately in two PowerShell windows:

```powershell
npm run dev:api
npm run dev:web
```

- Web: <http://localhost:5173>
- API health check: <http://localhost:4000/api/v1/health>

The health endpoint reports API process health; it does not claim that PostgreSQL is reachable.

## Environment variables

The repository-root `.env` contains only `VITE_API_BASE_URL`. `api/.env` contains `DATABASE_URL`, `API_PORT`, `NODE_ENV`, and `WEB_ORIGIN`; use `.env.example` as its template.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string in `api/.env`, consumed by Prisma |
| `API_PORT` | Express listen port (defaults to `4000`) |
| `NODE_ENV` | Runtime mode |
| `WEB_ORIGIN` | Exact trusted browser origin for CORS and unsafe-request origin checks (default `http://localhost:5173`) |
| `VITE_API_BASE_URL` | API base URL used by the browser; Vite variables are public |

Never place real secrets in source control. `.env` is ignored by Git.

## Authentication and authorization

- `POST /api/v1/auth/register` creates a tenant account. Public registration rejects a `role` field; owner/admin provisioning is not exposed publicly.
- `POST /api/v1/auth/login` uses the same generic error for an unknown email and an incorrect password and is rate limited.
- `GET /api/v1/auth/me` returns the current public user or `401`.
- `POST /api/v1/auth/logout` revokes the current session and requires the CSRF header.
- Passwords are hashed with Argon2id. Email addresses are trimmed and lowercased; a PostgreSQL lower-case unique index also enforces case-insensitive uniqueness.
- Sessions use random opaque tokens in `HttpOnly`, `SameSite=Lax` cookies. Only a SHA-256 token hash is stored in PostgreSQL. Cookies are `Secure` in production and expire after seven days. Logout revokes the database session.
- A session-bound CSRF token is kept in a readable `SameSite=Lax` cookie and must be echoed in `X-CSRF-Token` for logout and future authenticated write routes. The API also rejects requests carrying a different `Origin` from `WEB_ORIGIN`.
- The React app sends requests with `credentials: "include"`; it does not store session tokens in localStorage. Keep the frontend origin aligned with `WEB_ORIGIN`. Production requires HTTPS so the session cookie can use the `Secure` flag.
- Reusable role, property-owner, and tenant-record authorization middleware lives in `api/src/middleware/`. Property and booking routes apply these checks before returning or changing owner/tenant records.
- The login limiter uses an in-memory store suitable for a single development process. Deployments with multiple API instances should configure a shared rate-limit store.

## Properties, rooms and beds (Phase 4A)

The property models and uniqueness constraints were already present in the initial schema, so Phase 4A does not add or edit a migration. The existing migration files and the `btree_gist` tenancy exclusion constraint remain unchanged. A property is publicly browseable only when its status is `ACTIVE`; newly created properties start as private `DRAFT` records.

Public endpoints do not require a session:

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/properties` | Browse active properties with `page`, `pageSize` (max 50), `city`, `search`, and optional ISO date range filters. |
| `GET /api/v1/properties/:propertyId` | Read a published property's public details, rooms and bed availability. |

Property management endpoints require an authenticated `OWNER` or `ADMIN`; writes also require the session CSRF cookie/header pair. `OWNER` requests are scoped to the signed-in user's properties. The established authorization policy lets `ADMIN` manage any property. Only owners can create properties, and the API always takes `ownerId` from the signed-in session.

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/owner/properties` | List the signed-in owner's properties (`ADMIN` sees all). |
| `POST /api/v1/owner/properties` | Create a draft property. |
| `GET`, `PATCH`, `DELETE /api/v1/owner/properties/:propertyId` | Read, update or delete a property. |
| `GET`, `POST /api/v1/owner/properties/:propertyId/rooms` | List or create rooms. |
| `PATCH`, `DELETE /api/v1/owner/properties/:propertyId/rooms/:roomId` | Update or delete a room. |
| `GET`, `POST /api/v1/owner/properties/:propertyId/rooms/:roomId/beds` | List or create beds. |
| `PATCH`, `DELETE /api/v1/owner/properties/:propertyId/rooms/:roomId/beds/:bedId` | Update or delete a bed. |

Room numbers are unique within a property and bed labels are unique within a room; PostgreSQL constraints are the final authority, with duplicate conflicts returned as `409`. Child IDs are checked against their supplied parents. Deletion is rejected when dependent records exist, and deactivation/status changes are rejected when active bookings or tenancies depend on the resource. Public bed availability requires an `AVAILABLE` bed in an active room with no overlapping `CONFIRMED` booking or `ACTIVE` tenancy for the requested half-open date range. If no dates are supplied, availability is checked for the current UTC day. Public payloads intentionally omit tenant and booking records.

The React app includes public property search/detail pages and an owner dashboard with property, room and bed create/edit controls. The application uses the existing `VITE_API_BASE_URL`, cookie session and CSRF setup; run both dev servers from the repository root with `npm run dev`.

## Booking workflow (Phase 4B)

Bookings use the existing `PENDING`, `CONFIRMED`, `REJECTED`, and `CANCELLED` states. A tenant can request a bed only for a published property, active room and available bed. Requests require `startDate` and `endDate` in `YYYY-MM-DD` format; the start must be today or later in UTC and the end must be after the start. Dates use the half-open interval `[startDate, endDate)`, so a second confirmed booking can start on the previous booking's end date. Although the existing model permits a nullable `endDate` for compatibility, this API never creates a request without one and pending legacy records without an end date cannot be approved.

Pending requests do not reserve the bed. They do not block other pending requests or public availability. The owner decision rechecks conflicts immediately before confirmation; only a confirmed booking reserves its interval. On approval, the booking transitions `PENDING → CONFIRMED`; rejection is `PENDING → REJECTED`. A tenant can cancel a pending request at any time, or a confirmed booking before its start date. An owner can reject a pending request and can cancel a confirmed booking only before its start date. `REJECTED` and `CANCELLED` are terminal states; all other transitions return `409 INVALID_TRANSITION`. A date/bed conflict returns `409 BOOKING_CONFLICT`.

Tenant routes require an authenticated `TENANT` session; all writes require the CSRF token. Tenant identity is derived from the session, and tenant listing/detail/cancel operations are scoped to that identity. Owner routes require `OWNER` or `ADMIN`; owners are scoped to their properties and admins follow the existing all-property access policy. Unauthorized record IDs are concealed with `404`.

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/bookings` | Request a bed for a date range. The API creates the request as `PENDING`; client-supplied status and user IDs are rejected. |
| `GET /api/v1/bookings` | List the signed-in tenant's own requests. |
| `GET /api/v1/bookings/:bookingId` | Read one of the signed-in tenant's requests. |
| `POST /api/v1/bookings/:bookingId/cancel` | Cancel an eligible tenant request. |
| `GET /api/v1/owner/bookings?status=PENDING` | List requests for the signed-in owner's properties (`ADMIN` may omit the filter to see all). |
| `GET /api/v1/owner/bookings/:bookingId` | Read a request for an owned property (or any property as `ADMIN`). |
| `POST /api/v1/owner/bookings/:bookingId/approve` | Confirm a pending request if the date range is still free. |
| `POST /api/v1/owner/bookings/:bookingId/reject` | Reject a pending request. |
| `POST /api/v1/owner/bookings/:bookingId/cancel` | Cancel a confirmed future booking as its property owner. |

The new migration `20261017120000_booking_conflict_safety` adds a positive date-range check and a PostgreSQL GiST exclusion constraint for overlapping `CONFIRMED` bookings on the same bed. The original `btree_gist` extension and active-tenancy exclusion constraint remain in the initial migration. Request creation and approval also use a transaction-scoped PostgreSQL advisory lock per bed, then recheck confirmed bookings and active tenancies before writing. This serializes the supported booking decisions, while the exclusion constraint is the final database guarantee against concurrent overlapping confirmations. Public availability continues to consider only `CONFIRMED` bookings and `ACTIVE` tenancies, not pending requests.

The tenant property-detail page submits real booking requests and reloads availability after actions. Tenants can review/cancel their own requests at `/bookings`; owners can review and act on requests at `/manage/bookings`.

API tests use an in-memory repository and do not require PostgreSQL. The database-backed integration suite uses isolated, uniquely named records and cleans them up. Run it in PowerShell from `api/` after migrations are applied:

```powershell
$env:RUN_DB_INTEGRATION_TESTS = '1'
npm run test:integration
Remove-Item Env:RUN_DB_INTEGRATION_TESTS
```

That suite checks concurrent owner approvals, the database exclusion constraint against concurrent direct writes, adjacent half-open ranges, and conflicts with active tenancies.

## Tenancy lifecycle (Phase 4C)

Tenancies are created only by checking in a tenant from a confirmed booking. An owner (or `ADMIN` under the existing all-property policy) may check in on or after the booking start date. The API derives the tenant, bed, property relationship and `[startDate, endDate)` dates from the confirmed booking; client-supplied identity, dates and status are not accepted. The booking remains `CONFIRMED` as the source record, and the tenancy has a nullable unique `bookingId` link so retries return the existing tenancy instead of creating duplicates. A future booking cannot be checked in early. Booking cancellation remains the supported cancellation path before check-in.

Tenancy states use the existing enum: check-in creates `ACTIVE`; owner/admin checkout changes `ACTIVE → ENDED`. Ended and cancelled records are terminal; no cancellation action is exposed for a checked-in tenancy. `checkedInAt` and `checkedOutAt` record actual event times. The date columns retain the agreed booking interval and use half-open date semantics; early check-out ends active occupancy immediately by status, while the original agreed end date remains available for history. Same-day check-in/check-out remains representable via the timestamps without creating an invalid zero-length date range.

Tenant tenancy lists/details are restricted to the signed-in tenant. Owner lists/details and check-in/check-out operations are restricted to properties owned by the signed-in owner; admins follow the established all-property policy. Unauthorized record IDs are concealed with `404`. All writes require the existing CSRF token.

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/owner/bookings/:bookingId/check-in` | Convert an eligible confirmed booking into one active tenancy; idempotent on retry. |
| `GET /api/v1/tenancies` | List the signed-in tenant's own tenancies. |
| `GET /api/v1/tenancies/:tenancyId` | Read one of the signed-in tenant's own tenancies. |
| `GET /api/v1/owner/tenancies` | List tenancies for the owner's properties (`ADMIN` sees all). |
| `GET /api/v1/owner/tenancies/:tenancyId` | Read an authorized tenancy. |
| `POST /api/v1/owner/tenancies/:tenancyId/check-out` | End an active tenancy; retries after a successful checkout are idempotent. |

Check-in, checkout and booking approval use the same transaction-scoped PostgreSQL advisory lock derived from the bed UUID. Check-in re-reads the source booking after acquiring the lock, then checks for other overlapping confirmed bookings and active tenancies within the same transaction. It excludes only the exact source booking. The existing booking and active-tenancy GiST exclusion constraints remain the database-level final guards for their respective tables; the new forward-only `20261017150000_tenancy_booking_lifecycle` migration adds the unique source-booking link and actual check-in/check-out timestamps. It does not rewrite earlier migrations or remove the cross-booking exclusion or `btree_gist` constraints. Half-open ranges permit adjacent stays while rejecting overlap.

The owner dashboard includes the tenancy list, check-in action on eligible confirmed bookings, and checkout action. Tenants can view their own tenancy status at `/tenancies`. Both screens use the existing cookie session and CSRF-aware API client; tokens are not stored in browser localStorage.

Run API tests from `api/` with `npm test`. With the local PostgreSQL database configured and reviewed migrations applied, run the integration suite in PowerShell:

```powershell
$env:RUN_DB_INTEGRATION_TESTS = '1'
npm run test:integration
Remove-Item Env:RUN_DB_INTEGRATION_TESTS
```

The integration suite covers concurrent booking approval and tenancy check-in on one bed, idempotent conversion, active-tenancy conflicts, adjacent ranges and PostgreSQL exclusion constraints.

## Rent invoices and payment tracking (Phase 4D)

The existing `RentInvoice` model already has decimal amounts and a unique constraint on `(tenancyId, periodStart)`, which prevents duplicate invoices for a billing-period start. Invoice creation is available for `ACTIVE` or `ENDED` tenancies, and the billing period must be non-empty and lie within the tenancy's agreed date interval. New invoices are issued immediately; amounts use PostgreSQL `DECIMAL(12,2)` and are handled as decimal strings/Prisma Decimal values, not JavaScript floating-point arithmetic.

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/invoices` | List the signed-in tenant's invoices and payment histories. |
| `GET /api/v1/invoices/:invoiceId` | Read an invoice belonging to the signed-in tenant. |
| `GET /api/v1/owner/invoices` | List invoices for the signed-in owner's properties (`ADMIN` sees all). |
| `GET /api/v1/owner/invoices/:invoiceId` | Read an authorized invoice and its payment history. |
| `POST /api/v1/owner/tenancies/:tenancyId/invoices` | Issue an invoice for an eligible, authorized tenancy. |
| `POST /api/v1/owner/invoices/:invoiceId/payments` | Record a partial or full manual payment. |

Invoice creation takes `periodStart`, `periodEnd`, `dueDate`, `amount` (a decimal string with up to two fractional digits) and a three-letter `currencyCode`. Tenant and owner IDs, invoice status and balances are server-derived. Duplicate billing-period starts return `409 DUPLICATE_INVOICE`.

Payment recording takes a positive decimal amount, `paymentDate` (`YYYY-MM-DD`, not in the future), a method (`CASH`, `BANK_TRANSFER`, `UPI`, `CARD`, `CHEQUE` or `OTHER`), an optional reference and a UUID `idempotencyKey`. Payment currency comes from the invoice. The server appends the payment as a manually recorded `SUCCEEDED` entry, recalculates paid and outstanding amounts with decimal arithmetic, and updates invoice status to `ISSUED`, `OVERDUE` or `PAID`. This status means that an authorized owner entered the payment; it does not represent external gateway verification. Payment entries cannot be edited or deleted through the API.

All billing writes require an owner/admin session and CSRF validation. Owners are scoped to their properties; tenants can only read invoices for their own tenancy; admins follow the existing all-property policy. Resource IDs belonging to another tenant or owner are concealed with `404`. Payment requests lock the invoice row using `SELECT ... FOR UPDATE`, then re-read the invoice and payment history in the transaction before checking outstanding balance. Concurrent requests therefore serialize against the same balance. Reusing the same per-invoice idempotency key and identical payment details returns the existing result; reusing it with different details returns `409`.

The forward-only migration `20261017170000_rent_payments` adds a manual payment method enum, optional reference, per-invoice idempotency key with a unique database index, and database checks for positive amounts and valid invoice periods. The existing unique invoice constraint is preserved. Earlier migrations were not changed. There is no payment gateway integration in this phase.

The owner rent interface is at `/manage/rent`; tenant billing is at `/billing`. Both use the existing cookie session and CSRF-aware request pattern, and display payment dates, methods, references and balances. The owner interface creates invoices and appends payments; the tenant page is read-only.

The PostgreSQL integration suite also checks duplicate billing periods, partial/full payments, exact balances, idempotent retries and concurrent overpayment attempts. Enable it with `RUN_DB_INTEGRATION_TESTS=1` using the PowerShell instructions above.

## Checks

```powershell
npm test
npm run build
```

Vitest/Supertest tests cover health, authentication/session security, role and ownership authorization, property/room/bed endpoints, booking and tenancy lifecycles, invoice/payment validation and access isolation, balances, overpayments and retries. The standard API suite uses in-memory repositories; the optional booking and billing integration suites require the configured PostgreSQL database. Prisma Client generation is `npm run db:generate`; migrations are applied with `npm run db:migrate` in development or `npx prisma migrate deploy --schema=prisma/schema.prisma` from `api/` when applying reviewed migrations without creating new ones. The web workspace has a production build but no configured automated test script.

## Architecture notes

- `web/` is a React + TypeScript + Vite app with Tailwind CSS.
- `api/` is an Express + TypeScript REST API, versioned under `/api/v1`.
- Prisma schema and migrations belong in `api/prisma/`. The tenancy migration uses a PostgreSQL GiST exclusion constraint over `(bedId, [startDate, endDate))` for rows with `status = 'ACTIVE'`, so concurrent writes cannot create overlapping active tenancies. End dates are exclusive; an open-ended tenancy has a `NULL` end date.
- Request validation uses Zod. API errors are normalized by the final error middleware.
- The starter health endpoint is kept independent from the database so a process liveness check remains useful during database outages.
- Mobile development will live in `mobile/` and share the API; it is deferred because Flutter is not installed in the current environment.

## Next phases

1. Add complaint workflows with owner/tenant scoping.
2. Add server-verified payment-provider integration.
3. Add notification delivery, Flutter app, deployment guidance, and broader test coverage.
