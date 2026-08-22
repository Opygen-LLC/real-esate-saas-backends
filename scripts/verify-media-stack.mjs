const target = (process.env.PUBLIC_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '')
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 10000)

const requiredCorsMethods = new Set(['PUT', 'GET', 'HEAD'])

try {
  const response = await fetch(`${target}/ready`, { signal: controller.signal })
  const body = await response.json().catch(() => ({}))
  const storage = body?.dependencies?.objectStorage
  const clamav = body?.dependencies?.clamav
  const probes = Array.isArray(storage?.browserCors?.probes) ? storage.browserCors.probes : []
  const healthyMethods = new Set(probes.filter((probe) => probe?.healthy).map((probe) => probe?.method))
  const corsHealthy = storage?.browserCors?.healthy === true && [...requiredCorsMethods].every((method) => healthyMethods.has(method))

  if (!response.ok || !storage?.configured || !storage?.healthy || !corsHealthy || !clamav?.healthy) {
    console.error(JSON.stringify({ status: response.status, objectStorage: storage, clamav }, null, 2))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({
      status: 'ready',
      objectStorage: {
        configured: storage.configured,
        healthy: storage.healthy,
        endpoint: storage.endpoint,
        internalEndpoint: storage.internalEndpoint,
        bucket: storage.bucket,
        region: storage.region,
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
