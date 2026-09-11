const target = (process.env.PUBLIC_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '')
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 10000)
const requiredCorsMethods = new Set(['PUT', 'GET', 'HEAD'])

try {
  const response = await fetch(`${target}/ready`, { signal: controller.signal })
  const body = await response.json().catch(() => ({}))
  const storage = body?.dependencies?.objectStorage
  const clamav = body?.dependencies?.clamav
  const configuredMethods = new Set(Array.isArray(storage?.browserCors?.requiredMethods) ? storage.browserCors.requiredMethods : [])
  const corsHealthy = storage?.browserCors?.healthy === true
    && [...requiredCorsMethods].every((method) => configuredMethods.has(method))
  const r2Healthy = storage?.provider === 'r2'
    && storage?.configured === true
    && storage?.healthy === true
    && Boolean(storage?.accountId)
    && Boolean(storage?.endpoint)
    && Boolean(storage?.bucket)
    && storage?.privateBucket?.healthy === true

  if (!response.ok || !r2Healthy || !corsHealthy || !clamav?.healthy) {
    console.error(JSON.stringify({ status: response.status, objectStorage: storage, clamav }, null, 2))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({
      status: 'ready',
      objectStorage: {
        provider: storage.provider,
        configured: storage.configured,
        healthy: storage.healthy,
        accountId: storage.accountId,
        endpoint: storage.endpoint,
        bucket: storage.bucket,
        privateBucket: storage.privateBucket,
        browserCors: storage.browserCors,
      },
      clamav,
    }, null, 2))
  }
} catch (error) {
  console.error(`Media stack readiness check failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
}
