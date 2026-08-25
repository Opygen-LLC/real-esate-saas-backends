# Property Media deployment runbook — Google Cloud Storage

Property media uses one canonical object-storage provider: **Google Cloud Storage (GCS)**. Property photos, website-builder media and other managed media must use the existing `ObjectStorageService`; production and CI must not introduce a second S3/MinIO media path.

## 1. Required production configuration

Configure these canonical variables in the production secret/environment manager:

- `GCP_PROJECT_ID` — Google Cloud project that owns the media bucket.
- `GCP_BUCKET_NAME` — GCS bucket used by the application.
- `GCP_KEY_FILE` — optional service-account JSON path. Prefer Application Default Credentials on GCE/GKE/Cloud Run when available.
- `OBJECT_STORAGE_PUBLIC_BASE_URL` — optional HTTPS public prefix. If omitted, the server derives `https://storage.googleapis.com/<GCP_BUCKET_NAME>`.
- `OBJECT_STORAGE_BROWSER_ORIGIN` — dashboard origin, normally `https://realestate.opygen.com`.
- `OBJECT_STORAGE_SIGNED_URL_TTL` — signed upload URL lifetime; default is 600 seconds.
- `CLAMAV_HOST` / `CLAMAV_PORT` when ClamAV is the configured malware-scanning path.

Legacy `PROJECTS_ID`, `BUCKET_NAME` and `KEYFILENAME` aliases remain readable only for rolling-deployment compatibility. Do not add `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_INTERNAL_ENDPOINT`, MinIO credentials or S3 credentials to new deployments.

## 2. Configure bucket CORS

The browser uploads directly to signed GCS URLs, so the bucket must allow the dashboard origin to use `PUT`, `GET` and `HEAD`.

The repository contains the canonical policy at:

```text
ops/gcs-cors.json
```

Apply it with Google Cloud CLI:

```bash
gcloud storage buckets update gs://$GCP_BUCKET_NAME --cors-file=ops/gcs-cors.json
```

Verify the active configuration:

```bash
gcloud storage buckets describe gs://$GCP_BUCKET_NAME --format='default(cors_config)'
```

Do not use wildcard browser origins in production unless there is an explicit security requirement and review.

## 3. Authentication

Preferred order:

1. Application Default Credentials from the Google runtime/service account.
2. A least-privilege service-account key mounted into the API container and referenced by `GCP_KEY_FILE`.

The service account must be able to create/read/delete application objects, inspect bucket metadata/CORS, and sign URLs. Never expose the service-account JSON file to the frontend or place its contents in client environment variables.

## 4. Production Compose behavior

`docker-compose.production.yml` starts the API and reverse proxy only. It no longer starts MinIO or a MinIO initialization container. The API talks directly to GCS through `@google-cloud/storage`.

The existing mounted Google credential file remains supported for the current deployment. If the host is moved to a Google-managed runtime with ADC, remove the key-file mount as part of that deployment change and leave `GCP_KEY_FILE` unset.

## 5. Readiness verification

After deployment run:

```bash
pnpm verify:media
```

Or inspect:

```bash
curl -fsS https://api.faysaldev.com/ready
```

The object-storage dependency must report:

- `provider: "gcs"`
- `configured: true`
- `healthy: true`
- the expected `projectId`
- the expected `bucket`
- `browserCors.healthy: true`
- required CORS methods containing `PUT`, `GET` and `HEAD`

The verifier also checks the configured malware-scanning dependency because property assets are not allowed to become usable before the security-processing lifecycle completes.

## 6. Property image contract

Do not change the property image API shape when changing upload timing. Property create/update continues to receive structured metadata such as:

```ts
{
  assetId?: string
  url: string
  publicId?: string
  caption?: string
  isFeatured?: boolean
  order?: number
}
```

Raw `File`, `Blob`, base64 image data and multipart file content must never be embedded in the property create/update JSON payload. Draft assets remain tied to `propertyDraftSessionId` and are validated/claimed by the existing property-draft asset lifecycle.

## 7. Post-deployment checks

1. Verify `/ready` reports the intended GCS project and bucket.
2. Upload JPG/JPEG, PNG, WebP and AVIF property photos.
3. Confirm a 21st photo is rejected in both UI and API.
4. Confirm browser uploads work from `https://realestate.opygen.com` without CORS errors.
5. Confirm an unapproved browser origin cannot use the bucket CORS policy.
6. Import an HTTPS image URL and confirm the normalized asset URL points to the configured GCS public prefix.
7. Confirm malware/security processing reaches `ready` before an asset can be claimed by a property.
8. Confirm draft cleanup and property deletion remove the corresponding GCS objects and storage accounting is reconciled.
9. Run `pnpm verify:media` as part of release verification.

## Rollback

Rolling back application code does not require switching object-storage providers. GCS remains authoritative. If a deployment fails, restore the previous API/frontend build while preserving the same GCS bucket, credentials and property-media records. Do not re-enable MinIO as a rollback mechanism because that would split media ownership across two providers.
