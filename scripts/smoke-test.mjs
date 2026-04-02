const baseUrl = (process.env.DT_SHIPMENT_SMOKE_BASE_URL ?? 'http://127.0.0.1:18187').replace(/\/$/, '')
const username = process.env.DT_SHIPMENT_ADMIN_USERNAME ?? 'admin'
const password = process.env.DT_SHIPMENT_ADMIN_PASSWORD

async function expectJson(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init)
  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(payload)}`)
  }

  return payload
}

async function main() {
  if (!password) {
    throw new Error('DT_SHIPMENT_ADMIN_PASSWORD is required for smoke tests')
  }

  const health = await expectJson('/api/health')
  if (!health?.ok || health?.db !== 'ok') {
    throw new Error(`/api/health returned unexpected payload: ${JSON.stringify(health)}`)
  }

  const meta = await expectJson('/api/meta')
  if (!meta?.app?.version) {
    throw new Error(`/api/meta did not return app version: ${JSON.stringify(meta)}`)
  }

  const login = await expectJson('/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })

  if (!login?.token) {
    throw new Error(`/api/auth/login did not return token: ${JSON.stringify(login)}`)
  }

  const authHeaders = {
    authorization: `Bearer ${login.token}`,
  }

  const me = await expectJson('/api/auth/me', {
    headers: authHeaders,
  })
  if (me?.user?.username !== username) {
    throw new Error(`/api/auth/me returned unexpected user: ${JSON.stringify(me)}`)
  }

  const accounts = await expectJson('/api/accounts', {
    headers: authHeaders,
  })
  if (!Array.isArray(accounts)) {
    throw new Error(`/api/accounts did not return an array: ${JSON.stringify(accounts)}`)
  }

  const result = {
    ok: true,
    baseUrl,
    app: meta.app,
    accountCount: accounts.length,
    checkedAt: new Date().toISOString(),
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
