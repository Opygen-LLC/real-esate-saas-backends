# Phase 4 — Property Media 2.0 deployment runbook

Phase 4 replaces legacy `videos: string[]` property media with server-normalized structured media, enforces a 20-photo gallery, makes object storage and malware scanning production readiness dependencies, and removes fabricated property/legal fallback data from the frontend.

## 1. Before deployment

1. Back up MongoDB and the existing object/media store.
2. Keep the application on Phase 3 while preparing the media services.
3. Copy `.env.example` to your production secret-management system and replace every `replace-with-*` value.
4. In particular configure:
   - `OBJECT_STORAGE_BUCKET`
   - `OBJECT_STORAGE_REGION`
   - `OBJECT_STORAGE_ENDPOINT` — public HTTPS hostname reachable by browsers
   - `OBJECT_STORAGE_INTERNAL_ENDPOINT` — API-to-storage address; Compose overrides this to `http://minio:9000`
   - `OBJECT_STORAGE_ACCESS_KEY_ID`
   - `OBJECT_STORAGE_SECRET_ACCESS_KEY`
   - `OBJECT_STORAGE_PUBLIC_BASE_URL` — full public object prefix; with path-style MinIO include `/<bucket>`
   - `OBJECT_STORAGE_BROWSER_ORIGIN` — `https://realestate.opygen.com` for dashboard uploads
   - `OBJECT_STORAGE_REQUIRE_INTERNAL_ENDPOINT=true` when the API must use a private/internal storage address
   - `CLAMAV_HOST` / `CLAMAV_PORT`
5. Do not expose ClamAV port 3310 publicly. The production Compose network keeps it private to the API.

## 2. Object-storage hostname

The included production Compose binds MinIO only to loopback:

- API: `127.0.0.1:9000`
- Console: `127.0.0.1:9001`

Reverse-proxy `https://media.realestate.opygen.com` to `http://127.0.0.1:9000` without rewriting the path. An Nginx example is included at `ops/nginx-media.conf.example`.

The browser-facing hostname must match `OBJECT_STORAGE_ENDPOINT`; changing the host after a presigned URL is issued invalidates its signature.

`ops/minio-cors.xml` permits the central dashboard origin to PUT directly to object storage and GET/HEAD stored media. If the production dashboard origin changes, update that file before starting `minio-init`.

## 3. Start and verify media dependencies

Start the production stack using your normal Compose deployment. `minio-init` creates the bucket, enables public download for stored website media, and applies bucket CORS. ClamAV runs with a persistent signature database volume.

Before migrating property documents, verify API readiness:

```bash
pnpm verify:media
```

Or inspect:

```bash
curl -fsS https://api.faysaldev.com/ready
```

Production readiness must report all of the following:

- `dependencies.objectStorage.configured: true`
- `dependencies.objectStorage.healthy: true`
- `dependencies.objectStorage.browserCors.healthy: true`
- PUT, GET and HEAD CORS probes are healthy for `https://realestate.opygen.com` with `Content-Type` allowed
- `dependencies.clamav.healthy: true`

If object storage, its browser CORS policy, or ClamAV is unavailable, `/ready` returns 503 in production. Production also fails at startup when required object-storage configuration is missing, so fix environment configuration before restarting the API.

## 4. Dry-run the property-media migration

The migration is intentionally dry-run by default:

```bash
pnpm migrate:phase-4-media
```

Review the affected-document count. The migration covers:

- legacy `videos` fields
- existing `mediaLinks`
- galleries over 20 photos
- galleries with multiple featured photos

Invalid legacy hosted-media URLs are backed up and dropped rather than being converted into unsafe embeds.

## 5. Apply the migration

Use a write-disabled maintenance window so an old application instance cannot write legacy property media while the migration runs.

```bash
pnpm migrate:phase-4-media -- --apply --confirm=APPLY_PROPERTY_MEDIA_2
```

The migration writes document backups and a manifest under `MIGRATION_BACKUP_DIR` before changing data. It then verifies:

- zero remaining legacy `videos` fields
- zero galleries over 20 photos
- zero galleries with more than one featured image

Keep the backup and manifest with the release record.

## 6. Deploy Phase 4 application code

Deploy backend and frontend together after migration verification.

Important behavior after deployment:

- browser file uploads use presigned object-storage PUT URLs
- URL image import is downloaded by the API, checked for public HTTPS/SSRF safety, validated, stored internally, and scanned
- photos remain unavailable to property editors until their asset scan is `ready`
- properties accept at most 20 photos and 10 hosted media links
- YouTube, Vimeo, Matterport, and Kuula embed URLs are generated only by the backend
- arbitrary HTTPS media hosts are external links and cannot be selected as hero embeds
- one hosted media item can be the hero; public details fall back to the featured/first photo when hero media is unavailable

## 7. Post-deployment checks

1. Upload JPG, PNG, WebP and AVIF files.
2. Verify a 21st photo is rejected in both the UI and API.
3. Import a public HTTPS image URL and verify the returned URL points at your own media hostname.
4. Confirm private/loopback image URLs are rejected.
5. Add one URL for each supported provider: YouTube, Vimeo, Matterport and Kuula.
6. Set each supported item as hero and confirm only one remains selected.
7. Add an arbitrary HTTPS hosted-media URL and confirm it opens externally instead of rendering in an iframe.
8. Temporarily use an invalid/unavailable hero media item and confirm the property page remains usable with a property photo fallback.
9. Open `/dashboard/admin/properties/add` at 320, 375 and 430 px, then tablet, laptop and desktop widths. Verify the six-step wizard scrolls horizontally only on narrow screens, form padding stays compact, footer actions remain full-width/tappable on phones, and media/URL controls never cause page overflow.
10. Open a property with missing specs/legal fields and confirm the UI displays `—`/not-provided states instead of invented values or verification claims.

## Rollback

Application rollback requires restoring the Phase 3 application **and** restoring the affected property documents from the Phase 4 migration backup, because Phase 3 still understands the legacy `videos` field while Phase 4 removes it. Do not attempt a code-only rollback after the migration has been applied.
