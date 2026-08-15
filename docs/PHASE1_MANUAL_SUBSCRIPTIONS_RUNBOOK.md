# Phase 1 Manual Subscription Payments

The subscription payment source of truth is now `subscriptionpayments`. Gateway checkout/reconciliation routes are no longer mounted. `billings` remains only as legacy data and as compatibility fallback for old receipts.

## Required production order

1. Back up MongoDB using the normal production backup process.
2. Run a dry-run:
   `pnpm migrate:phase-1-manual-subscriptions`
3. Review the counts printed by the dry-run. If `duplicatePendingRequests`, `duplicateOpenTenantRequests`, or `duplicateBusinessKeys` is non-zero, resolve those records before applying; the migration fails closed rather than guessing which payment/request is authoritative.
4. Apply with migration backups enabled:
   `pnpm migrate:phase-1-manual-subscriptions -- --apply --confirm=PHASE1-MANUAL-SUBSCRIPTIONS --backup-dir=/secure/backup/path`
5. Verify the generated JSONL backups, SHA-256 files, and migration manifest.
6. Deploy backend and frontend from the same release.
7. Verify agency plan request -> admin record payment -> admin confirm -> agency usage/receipt synchronization.

Production payment confirmation fails closed when MongoDB transactions are unavailable. Use a replica set or mongos.

## Deprecated files

The files listed in `docs/PHASE1_DELETE_FILES.txt` are no longer reachable by the application and should be removed from the full repository after this patch is applied. They are listed explicitly because the delivery ZIP contains changed/new files only and cannot delete files in an existing checkout by extraction alone.
