# Phase 5 — Finance Billing deployment runbook

## Scope
This phase adds invoice edit/void/archive controls, server-rendered PDF downloads, append-only payment history, finance audit events, mobile invoice cards, and paid-record immutability.

## Database migration
No destructive migration is required. The new invoice fields (`cancelledAt`, `cancelledBy`, `cancelReason`, `archivedAt`, `archivedBy`, `archiveReason`) are optional/defaulted and are backward compatible with existing documents. Mongoose will build the added archive index according to the application's normal index policy.

## Production prerequisites
1. Keep MongoDB as a replica set or mongos. In production invoice-payment recording fails closed if transactions are unavailable, preventing a payment transaction and invoice balance from diverging.
2. Rebuild the backend container. The runtime image installs Chromium and Noto Bengali fonts used by the server-side invoice PDF renderer.
3. Keep these environment values (defaults shown):
   - `INVOICE_PDF_CHROMIUM_PATH=/usr/local/bin/invoice-chromium`
   - `INVOICE_PDF_TIMEOUT_MS=20000`
4. Run `pnpm verify:phase5-finance` after deployment.

## Finance invariants
- Draft + unpaid: editable and can be archived (soft delete).
- Sent/overdue + unpaid: editable and can be voided with a reason.
- Partial/paid: financial fields are immutable. Only client phone, client email, and notes may be corrected.
- Payment history is append-only through the payment endpoint; invoice payments and the generated income transaction are committed together when Mongo transactions are available.
- Archived drafts are excluded from normal invoice list/detail queries but remain in the database for auditability.
- Voided invoices remain visible and downloadable as PDFs marked VOID.

## Smoke test
1. Create a draft invoice and edit line items.
2. Archive a draft and confirm it disappears from the normal invoice list.
3. Create/send another invoice, void it with a reason, and download the VOID PDF.
4. Create/send an invoice and record a partial payment; verify payment history and outstanding balance.
5. Attempt to modify its amount/discount/line items; expect HTTP 409.
6. Correct only client email/phone/notes; expect success.
7. Record the remaining payment; verify status becomes `paid` and the payment history remains intact.
8. Download the PDF and confirm agency details, totals and payment history render correctly in English/Bangla text.
