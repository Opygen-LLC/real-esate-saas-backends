const apiUrl = process.env.SMOKE_API_URL?.replace(/\/$/, '')
const frontendUrl = process.env.SMOKE_FRONTEND_URL?.replace(/\/$/, '')
if (!apiUrl) throw new Error('SMOKE_API_URL is required')

const assertOk = async (url, expectedText) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'x-smoke-test': 'phase7' } })
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    const body = await response.text()
    if (expectedText && !body.includes(expectedText)) throw new Error(`${url} did not include expected health marker`)
  } finally { clearTimeout(timer) }
}

await assertOk(`${apiUrl}/health`, 'ok')
await assertOk(`${apiUrl}/ready`, 'ready')
if (frontendUrl) await assertOk(`${frontendUrl}/healthz`, 'ok')
console.log('Release smoke test passed.')
