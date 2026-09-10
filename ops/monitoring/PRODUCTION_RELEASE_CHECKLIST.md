# Production security release checklist

A production promotion is allowed only when all items below are confirmed:

- Backend and frontend CI are green for the exact commit being released.
- Full-history and working-tree secret scans pass; any historical secret was rotated before release.
- Dependency audit has no unresolved high/critical production vulnerability accepted without a documented exception.
- CodeQL/static analysis and dependency review checks are green.
- API and backup container images pass high/critical vulnerability scanning.
- Production HTTPS, HSTS, trusted proxy, CORS allowlist, CSRF, secure cookie, and private no-store policies are verified by the live smoke test.
- Redis rate limiting and application usage budgets are healthy; provider-side budget alerts/hard caps are confirmed and `PROVIDER_BUDGETS_VERIFIED=true` is set in the protected environment.
- Public/private storage IAM separation is healthy; private downloads remain authenticated/signed and malware scanning is healthy.
- Latest database backup is within the accepted age and its automated restore verification succeeded.
- Error reporting/logging has been sampled to confirm no authorization headers, cookies, passwords, OTPs, reset tokens, API keys, database credentials, payment credentials, or signed private URLs are present.
- Worker/scheduler, cron signatures, domain queues, `/health`, `/ready`, authenticated `/metrics`, and alert delivery are healthy.
- Production browser source maps are disabled unless a separately protected artifact workflow is used.
