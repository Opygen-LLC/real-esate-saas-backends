#!/usr/bin/env node
import {
  arg,
  fail,
  loadGcsServiceAccount,
  redactError,
  requireMigrationBuckets,
  selectedScopes,
} from './lib/common.mjs'
import { cloudflareContext, cloudflareRequest } from './lib/cloudflare.mjs'

const action = String(process.argv[2] || 'list').trim().toLowerCase()
const validActions = new Set(['precheck', 'create', 'list', 'status', 'logs', 'pause', 'resume', 'abort'])
if (!validActions.has(action)) {
  fail('Usage: node scripts/storage-migration/super-slurper.mjs <precheck|create|list|status|logs|pause|resume|abort> [--scope=public|private|all] [--job-id=...]')
}

const { accountId } = cloudflareContext()
const buckets = requireMigrationBuckets()
const scopes = selectedScopes()
const r2AccessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim()
const r2SecretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim()
if (!r2AccessKeyId || !r2SecretAccessKey) fail('R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required')

const needsGcsCredentials = ['precheck', 'create'].includes(action)
const credentials = needsGcsCredentials ? loadGcsServiceAccount() : null
const pathPrefix = arg('prefix').trim().replace(/^\/+/, '')
const jobId = arg('job-id').trim()
const listLimit = Math.max(1, Math.min(100, Number(arg('limit', '50')) || 50))
const listOffset = Math.max(0, Number(arg('offset', '0')) || 0)

const mappingFor = (scope) => scope === 'private'
  ? { scope, source: buckets.gcsPrivate, destination: buckets.r2Private }
  : { scope, source: buckets.gcsPublic, destination: buckets.r2Public }

const sourcePayload = (mapping) => ({
  vendor: 'gcs',
  bucket: mapping.source,
  secret: {
    clientEmail: credentials.clientEmail,
    privateKey: credentials.privateKey,
  },
  ...(pathPrefix ? { pathPrefix } : {}),
})

const targetPayload = (mapping) => ({
  vendor: 'r2',
  bucket: mapping.destination,
  secret: {
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
  },
})

const summarizeJob = (value) => ({
  id: value?.id || null,
  status: value?.status || null,
  createdAt: value?.createdAt || null,
  finishedAt: value?.finishedAt || null,
  overwrite: value?.overwrite ?? null,
  source: value?.source ? {
    vendor: value.source.vendor || null,
    bucket: value.source.bucket || null,
    pathPrefix: value.source.pathPrefix || null,
  } : null,
  target: value?.target ? {
    vendor: value.target.vendor || null,
    bucket: value.target.bucket || null,
  } : null,
})

try {
  if (action === 'list') {
    const result = await cloudflareRequest(`/accounts/${encodeURIComponent(accountId)}/slurper/jobs`, {
      query: { limit: listLimit, offset: listOffset },
    })
    const jobs = Array.isArray(result) ? result : (result?.jobs || result?.items || [])
    console.log(JSON.stringify({ jobs: jobs.map(summarizeJob), limit: listLimit, offset: listOffset }, null, 2))
    process.exit(0)
  }

  if (['status', 'logs', 'pause', 'resume', 'abort'].includes(action)) {
    if (!jobId) fail(`--job-id is required for ${action}`)
    const encodedJob = encodeURIComponent(jobId)
    if (action === 'status') {
      const details = await cloudflareRequest(`/accounts/${encodeURIComponent(accountId)}/slurper/jobs/${encodedJob}`)
      const progress = await cloudflareRequest(`/accounts/${encodeURIComponent(accountId)}/slurper/jobs/${encodedJob}/progress`).catch(() => null)
      console.log(JSON.stringify({ job: summarizeJob(details), progress }, null, 2))
      process.exit(0)
    }
    if (action === 'logs') {
      const logs = await cloudflareRequest(`/accounts/${encodeURIComponent(accountId)}/slurper/jobs/${encodedJob}/logs`, {
        query: { limit: listLimit, offset: listOffset },
      })
      console.log(JSON.stringify({ jobId, logs }, null, 2))
      process.exit(0)
    }
    if (['pause', 'resume', 'abort'].includes(action)) {
      if (process.env.SLURPER_MUTATION_CONFIRM !== `allow-${action}-migration-job`) {
        fail(`Set SLURPER_MUTATION_CONFIRM=allow-${action}-migration-job before ${action}`)
      }
      const result = await cloudflareRequest(`/accounts/${encodeURIComponent(accountId)}/slurper/jobs/${encodedJob}/${action}`, { method: 'PUT' })
      console.log(JSON.stringify({ action, jobId, result }, null, 2))
      process.exit(0)
    }
  }

  const results = []
  for (const scope of scopes) {
    const mapping = mappingFor(scope)
    if (action === 'precheck') {
      const sourceResult = await cloudflareRequest(`/accounts/${encodeURIComponent(accountId)}/slurper/source/connectivity-precheck`, {
        method: 'PUT',
        body: sourcePayload(mapping),
      })
      const targetResult = await cloudflareRequest(`/accounts/${encodeURIComponent(accountId)}/slurper/target/connectivity-precheck`, {
        method: 'PUT',
        body: targetPayload(mapping),
      })
      results.push({
        scope,
        sourceBucket: mapping.source,
        targetBucket: mapping.destination,
        sourceConnectivity: sourceResult?.connectivityStatus || null,
        targetConnectivity: targetResult?.connectivityStatus || null,
      })
      continue
    }

    if (action === 'create') {
      if (process.env.SLURPER_CREATE_CONFIRM !== 'start-gcs-to-r2-migration') {
        fail('Set SLURPER_CREATE_CONFIRM=start-gcs-to-r2-migration before creating migration jobs')
      }
      const result = await cloudflareRequest(`/accounts/${encodeURIComponent(accountId)}/slurper/jobs`, {
        method: 'POST',
        body: {
          overwrite: false,
          source: sourcePayload(mapping),
          target: targetPayload(mapping),
        },
      })
      if (!result?.id) throw new Error(`Cloudflare did not return a migration job id for ${scope}`)
      results.push({
        scope,
        jobId: result.id,
        sourceBucket: mapping.source,
        targetBucket: mapping.destination,
        overwrite: false,
        pathPrefix: pathPrefix || null,
      })
    }
  }

  console.log(JSON.stringify({ action, results }, null, 2))
} catch (error) {
  fail(`${action} failed: ${redactError(error)}`)
}
