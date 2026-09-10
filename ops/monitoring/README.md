# Production security monitoring and release controls

Load `security-alerts.yml` into the Prometheus-compatible alerting system that scrapes the authenticated `/metrics` endpoint. Store `METRICS_TOKEN` only in the monitoring secret store. Never put it in dashboards, URLs, source code, or scrape labels.

The API emits bounded structured security events without request bodies, query strings, cookies, authorization headers, OTPs, passwords, reset tokens, private object URLs, or payment credentials. Alert routing should preserve `requestId`, normalized route, organization ID where present, status, event name, and hashed network identifiers only.

Before enabling a production environment, configure provider-side budget alerts and hard limits wherever the provider supports them. At minimum cover cloud compute/serverless, database, public and private object storage/egress, SMS/OTP, email, Meta/WhatsApp, maps/search, image processing, and any AI provider. Application Redis usage budgets are a second line of defense; they do not replace cloud billing alerts. Set the protected deployment variable `PROVIDER_BUDGETS_VERIFIED=true` only after an operator has confirmed those external controls.

Production release smoke intentionally fails if the latest database backup has not been restore-verified, is older than `BACKUP_MAX_AGE_HOURS` (default 36), critical dependencies are unhealthy, metrics are publicly readable, CORS reflects an attacker origin, or HTTP is not redirected to HTTPS.

Recommended incident routing:
- `critical`: page the on-call owner and create an incident.
- `warning`: notify the operations/security channel with the dashboard link and normalized route/tenant context.
- never paste raw authorization headers, cookies, signed URLs, OTPs, reset links, database URIs, or provider keys into an incident.

Review alert thresholds against real traffic after launch. The defaults are deliberately conservative release-safe baselines, not permanent capacity targets.
