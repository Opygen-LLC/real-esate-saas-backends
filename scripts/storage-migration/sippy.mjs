#!/usr/bin/env node
import {
  fail,
  loadGcsServiceAccount,
  redactError,
  requireMigrationBuckets,
  selectedScopes,
} from './lib/common.mjs'
import { cloudflareContext, cloudflareRequest } from './lib/cloudflare.mjs'

const action = String(process.argv[2] || 'status').trim().toLowerCase()
if (!['status', 'enable', 'disable'].includes(action)) {
  fail('Usage: node scripts/storage-migration/sippy.mjs <status|enable|disable> [--scope=public|private|all]')
}

const { accountId } = cloudflareContext()
const buckets = requireMigrationBuckets()
const scopes = selectedScopes()
const r2AccessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim()
const r2SecretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim()
if (!r2AccessKeyId || !r2SecretAccessKey) fail('R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required')

const credentials = action === 'enable' ? loadGcsServiceAccount() : null
if (action === 'enable' && process.env.SIPPY_ENABLE_CONFIRM !== 'enable-gcs-to-r2-sippy') {
  fail('Set SIPPY_ENABLE_CONFIRM=enable-gcs-to-r2-sippy before enabling Sippy')
}
if (action === 'disable' && process.env.SIPPY_DISABLE_CONFIRM !== 'disable-gcs-to-r2-sippy') {
  fail('Set SIPPY_DISABLE_CONFIRM=disable-gcs-to-r2-sippy before disabling Sippy')
}

const mappingFor = (scope) => scope === 'private'
  ? { scope, source: buckets.gcsPrivate, destination: buckets.r2Private }
  : { scope, source: buckets.gcsPublic, destination: buckets.r2Public }

const summarize = (scope, mapping, result) => ({
  scope,
  sourceProvider: result?.source?.provider || 'gcs',
  sourceBucket: result?.source?.bucket || mapping.source,
  destinationProvider: result?.destination?.provider || 'r2',
  destinationBucket: result?.destination?.bucket || mapping.destination,
  enabled: Boolean(result?.enabled),
})

const output = []
for (const scope of scopes) {
  const mapping = mappingFor(scope)
  const path = `/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(mapping.destination)}/sippy`
  try {
    if (action === 'status') {
      const result = await cloudflareRequest(path)
      output.push(summarize(scope, mapping, result))
      continue
    }

    if (action === 'enable') {
      const result = await cloudflareRequest(path, {
        method: 'PUT',
        body: {
          source: {
            provider: 'gcs',
            bucket: mapping.source,
            clientEmail: credentials.clientEmail,
            privateKey: credentials.privateKey,
          },
          destination: {
            provider: 'r2',
            accessKeyId: r2AccessKeyId,
            secretAccessKey: r2SecretAccessKey,
          },
        },
      })
      const summary = summarize(scope, mapping, result)
      if (!summary.enabled) throw new Error(`Cloudflare did not report Sippy enabled for ${mapping.destination}`)
      output.push(summary)
      continue
    }

    const result = await cloudflareRequest(path, { method: 'DELETE' })
    output.push({
      scope,
      sourceBucket: mapping.source,
      destinationBucket: mapping.destination,
      enabled: Boolean(result?.enabled),
    })
  } catch (error) {
    fail(`${action} failed for ${scope} migration (${mapping.source} -> ${mapping.destination}): ${redactError(error)}`)
  }
}

console.log(JSON.stringify({ action, mappings: output }, null, 2))
