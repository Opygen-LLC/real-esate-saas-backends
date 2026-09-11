#!/usr/bin/env node
console.warn('[deprecated] setup-gcs-cors.js now delegates to Cloudflare R2. Use: node scripts/setup-r2-cors.mjs')
import('./setup-r2-cors.mjs').catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
