# 502 Bad Gateway Fix — realestate.opygen.com/backend-api/property

## Root Cause

Three interconnected issues caused the 502:

### 1. Wrong API proxy target (primary cause)
In `next.config.ts`, the proxy fallback defaulted to:
```
API_PROXY_TARGET = "https://api-5000.faysaldev.com"
```
This is a **different server** (`faysaldev.com`, not `opygen.com`).  
When the frontend container was started without `API_PROXY_TARGET` set, every
`/backend-api/*` request was forwarded to this stale host, which either refused
connections or returned 502 from its own proxy.

**Fix:** `next.config.ts` now defaults to `http://api:5000` — the backend
container's Docker-internal hostname — so it works without any env var.

---

### 2. CORS blocked the preflight, gateway surfaced it as 502
The browser sends a CORS preflight `OPTIONS` to `/backend-api/property` before
the real `POST`. Because `ALLOWED_ORIGINS` was `*` in the `.env.example` but
the production config expected a specific origin, the CORS middleware rejected
the preflight with a 403. Caddy/Nginx then saw no successful upstream response
and returned 502.

**Fix:**
- `corsPolicy.ts`: Preflight from a trusted origin now always passes through.
  Untrusted origins are rejected with a clear 403 (not swallowed as 502).
- `.env.production`: `ALLOWED_ORIGINS=https://realestate.opygen.com` (exact match).

---

### 3. Backend `PUBLIC_API_URL` pointed to a bare IP
`PUBLIC_API_URL=http://34.131.86.177` caused:
- Cookie `SameSite=none` + `Secure=true` to be rejected (IP != HTTPS hostname)
- The backend config validation to derive wrong cookie settings
- Auth cookies not being sent on cross-origin API requests → 401 → 502 loop

**Fix:** `.env.production` sets `PUBLIC_API_URL=https://realestate.opygen.com`.

---

## Files Changed

| File | What changed |
|------|-------------|
| `backend/next.config.ts` | Default proxy target changed from `api-5000.faysaldev.com` → `http://api:5000` |
| `backend/src/app/middlewares/corsPolicy.ts` | Preflight handling clarified; untrusted origins return 403 not silence |
| `backend/.env.production` | `PUBLIC_API_URL`, `CLIENT_URL`, `ALLOWED_ORIGINS` set to `https://realestate.opygen.com`; `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none`; `REDIS_HOST=redis` (Docker DNS) |
| `backend/docker-compose.production.yml` | API port no longer published to host (only internal); Redis healthcheck dependency added; `PUBLIC_API_URL` and `ALLOWED_ORIGINS` required |
| `backend/Caddyfile` | Routes all traffic to `frontend:3000`; timeout increased to 180s; health check added |
| `backend/docker-compose.combined.yml` | **New** — single compose file for both frontend + backend on one server |
| `frontend/next.config.ts` | Default proxy target `http://api:5000`; detailed comments added |
| `frontend/.env.production` | `API_PROXY_TARGET=http://api:5000`; `NEXT_PUBLIC_USE_API_PROXY=true` |
| `frontend/docker-compose.frontend.yml` | **New** — frontend service definition with correct env wiring |

---

## Deployment Steps

### If running everything on one server (recommended):

```bash
# 1. Copy the combined compose file
cp docker-compose.combined.yml /opt/realestate/docker-compose.yml

# 2. Copy both env files and merge them
cp backend/.env.production /opt/realestate/.env
# Edit .env — fill in DB passwords, GCP key, backup URL, JWT secrets

# 3. Copy the Caddyfile
cp Caddyfile /opt/realestate/Caddyfile

# 4. Copy the GCP service account key
cp opy-realestate-505614-d4e3b5e9f13d.json /opt/realestate/

# 5. Build and start
cd /opt/realestate
docker compose build
docker compose up -d

# 6. Check logs
docker compose logs -f caddy
docker compose logs -f api
docker compose logs -f frontend
```

### Verify the fix:

```bash
# Should return 200 with {"success":true} (not 502)
curl -i https://realestate.opygen.com/health

# Should return the Next.js app
curl -I https://realestate.opygen.com

# Inside the server — should reach the API directly
docker exec -it $(docker compose ps -q api) wget -qO- http://127.0.0.1:5000/health
```

---

## Why the frontend should NOT talk to the API via the public domain

The Next.js reverse proxy (`/backend-api/*` → `http://api:5000`) means:
- Browser sends `POST /backend-api/property` to `realestate.opygen.com`
- Caddy forwards it to `frontend:3000`
- Next.js rewrites it to `http://api:5000/api/v1/property`
- Auth cookies are first-party (same origin `realestate.opygen.com`)
- No CORS issues because the browser sees only one origin

If the frontend called `https://realestate.opygen.com/api/v1/*` directly,
cookies would need `SameSite=none; Secure` and CORS `credentials: include` —
which is what was causing intermittent failures.
