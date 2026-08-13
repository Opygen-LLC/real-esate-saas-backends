# Phase 7 release and rollback runbook

## Release gate

A release candidate is eligible for staging only after formatting, lint, typecheck, unit, contract, security, replica-set integration, production build, migration replay, dependency audit, container scan, and secret scan all pass in CI. Do not waive a tenant-isolation, payment-integrity, backup, or migration failure.

The integration database must be disposable and run as a Mongo replica set because tenant provisioning, plan versioning, publishing, and billing rely on transactions. Migration verification deliberately runs every supported migration twice against a disposable database to catch non-idempotent changes.

## Staging

Configure the protected `staging` GitHub Environment with `STAGING_DEPLOY_WEBHOOK`, `STAGING_API_URL`, `STAGING_FRONTEND_URL`, `STAGING_TEST_ORGANIZATION_ID`, `STAGING_TEST_USER_EMAIL`, `STAGING_TEST_USER_PASSWORD`, and `STAGING_TEST_BKASH_PAYMENT_ID`. The deployment webhook must deploy the exact immutable commit supplied in the `X-Release-Sha` header rather than rebuilding an arbitrary branch head.

Deploy the immutable image produced from the approved commit. Run `SMOKE_API_URL=... SMOKE_FRONTEND_URL=... pnpm test:smoke`. For representative performance checks, set `LOAD_TARGET=staging`, `LOAD_API_URL`, `LOAD_ORGANIZATION_ID`, authenticated test-user credentials (or `LOAD_AUTH_TOKEN` for manual runs), and `LOAD_BKASH_PAYMENT_ID`, then run `pnpm test:load`. Load checks create staging leads; never aim them at production without an explicit approved exercise.

Validate the end-to-end pilot journey: agency signup and OTP verification, onboarding, listing creation, website publish, public lead capture, CRM visibility, bKash checkout/callback idempotency, and paid invoice visibility. Provider sandbox/test-event credentials must be used in staging.

## Production approval

Production is a protected GitHub Environment. Configure required reviewers plus `PRODUCTION_DEPLOY_WEBHOOK`, `PRODUCTION_API_URL`, and `PRODUCTION_FRONTEND_URL` in environment-scoped secrets/variables. The workflow verifies that the selected commit passed Backend CI and sends that exact commit in `X-Release-Sha`; the deployment endpoint must honor it. Promote the same tested artifact and never rebuild from a different commit. Before approval, confirm bKash production credentials/callback approval, current backup status, on-call ownership, and zero unresolved P0/P1 pilot defects.

## Backward-compatible migration rule

Deploy additive schema/index changes before code that requires them. Never remove or rename fields in the same release that stops writing their predecessor. Keep migrations idempotent and safe to replay. Database migrations must not be used as a rollback mechanism for user data.

## Rollback

1. Stop further production promotion and record the incident/release identifier.
2. Roll application traffic back to the previous known-good immutable image while leaving additive database changes in place.
3. If a provider integration is causing failures, disable its worker/feature flag instead of deleting queued jobs.
4. Verify `/health`, `/ready`, public portal reads, authenticated tenant reads, lead capture, and billing status on the rolled-back version.
5. Restore data from backup only for confirmed data corruption and only through the documented restore drill; a code rollback is preferred for application defects.
6. Preserve request IDs, payment IDs, queue jobs, audit events, and deployment logs for the incident review.

## Pilot launch gate

Public launch requires two pilot agencies to complete the full journey without open P0/P1 defects, successful backup restore evidence, clean tenant-isolation/security tests, approved bKash production behavior, and named support/on-call ownership.
