const target = (process.env.PUBLIC_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '')
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 10000)
try {
  const response = await fetch(`${target}/ready`, { signal: controller.signal })
  const body = await response.json().catch(() => ({}))
  const storage = body?.dependencies?.objectStorage
  const clamav = body?.dependencies?.clamav
  if (!response.ok || !storage?.healthy || !clamav?.healthy) {
    console.error(JSON.stringify({ status: response.status, objectStorage: storage, clamav }, null, 2))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({ status: 'ready', objectStorage: storage, clamav }, null, 2))
  }
} catch (error) {
  console.error(`Media stack readiness check failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
}
