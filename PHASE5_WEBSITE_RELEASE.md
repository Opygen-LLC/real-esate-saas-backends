# Phase 5 website release gate

This release keeps renderer selection version-bound so deploying the redesigned templates cannot silently restyle an existing tenant.

## Renderer policy

- `legacy-v1` is the fail-safe renderer for historical records with no renderer marker.
- `premium-v2` is the redesigned renderer introduced for templates 3–10.
- Templates 1 and 2 are preserved byte-for-byte by the Phase 5 verifier.
- `WEBSITE_RENDERER_ROLLOUT_MODE=disabled` is the default and blocks legacy -> premium publication.
- `WEBSITE_RENDERER_ROLLOUT_MODE=opt-in` allows an owner to explicitly upgrade in Website Studio.
- `WEBSITE_RENDERER_ROLLOUT_MODE=new-sites` also gives newly provisioned sites the current renderer. It does not rewrite existing tenants.
- `WEBSITE_RENDERER_ROLLOUT_ORGANIZATIONS` optionally restricts existing-tenant `legacy-v1` -> `premium-v2` publication to a comma-separated pilot cohort. Leave it empty only when every existing tenant eligible for the selected rollout mode may opt in. `new-sites` still assigns `premium-v2` to newly provisioned sites by design.
- Downgrading/restoring from `premium-v2` to `legacy-v1` remains allowed even if rollout is paused.

Do not remove the legacy renderer or its CSS during the migration/rollback window.

## Required deployment order

1. Back up the database using the normal production backup procedure and verify a restore target exists.
2. Keep `WEBSITE_RENDERER_ROLLOUT_MODE=disabled` and configure `WEBSITE_RENDERER_ROLLOUT_ORGANIZATIONS` for the initial pilot cohort.
3. Run `pnpm migrate:phase5-website-renderer` with no apply flag. Review the counts. This is a dry run and writes nothing.
4. Run backend `pnpm gate:phase5-website-rollout` and frontend `pnpm gate:phase5-website-rollout` in CI.
5. Against an isolated staging replica-set database and disposable agency tenant, run the backend and frontend staging gates documented below.
6. Apply the renderer-binding migration only after the dry-run counts and backup location are reviewed:
   `pnpm migrate:phase5-website-renderer -- --apply --confirm=APPLY_PHASE5_WEBSITE_RENDERER_BINDING`
   The migration creates JSONL backups and a migration manifest before modifying records. It only adds the missing renderer marker and does not rewrite content, template IDs, branding, or publication data.
7. Deploy the backend first, then the frontend, while rollout remains `disabled`. Mixed-version frontend/backend windows fail closed in Studio.
8. Smoke-test existing tenants and confirm they still render through `legacy-v1` where expected.
9. Change rollout to `opt-in` only after the release gate is green. An owner must explicitly choose the redesigned renderer and publish it.
10. Move to `new-sites` only when new tenant provisioning is approved to use the current renderer by default.

## Backend release gates

`pnpm gate:phase5-website-rollout` runs formatting, linting, application/test typechecks, the production build, unit/contract/security suites, Phase 1–3 regressions, renderer-rollout regressions, structural verification, and a high-severity dependency audit.

`pnpm gate:phase5-website-rollout:staging` additionally requires a disposable `TEST_DATABASE_URL` and explicit read-only profiling target (`PHASE2_DATABASE_URL`, `PHASE2_ORGANIZATION_ID`). It runs the integration suite, renderer rollback integration tests, catalog execution-stat profiling, and query-plan verification.

Never point the integration database variables at a customer database. The Phase 5 renderer integration suite requires a database whose path starts with `/phase5_website_rollout_`.

## Rollback

- Pause future upgrades immediately with `WEBSITE_RENDERER_ROLLOUT_MODE=disabled`.
- For an upgraded tenant, restore a historical Website Studio revision bound to `legacy-v1` and publish it. The service allows current -> legacy rollback even while rollout is paused.
- If the renderer-binding migration itself must be reverted, restore the affected documents from the JSONL files named in the migration manifest before changing rollout mode.
- The release must retain both renderer generations until the rollback window is formally closed.

## Monitoring

The application emits scrubbed production events for:

- `website_publish_failed`
- `public_form_failed`
- `public_property_query_failed`
- `website_image_delivery_failed`

Monitor these events, HTTP 5xx/409 rates, worker/outbox failures, and image/CDN availability during rollout. The events intentionally avoid visitor form values and image URLs.
