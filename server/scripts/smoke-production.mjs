import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import 'dotenv/config'

const password = randomBytes(24).toString('hex')
const port = 3097
const child = spawn(process.execPath, ['dist/src/main.js'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port), AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-not-a-real-key', PILOT_USER: 'smoke', PILOT_PASSWORD: password,
    WEB_DIST_DIR: resolve('../dist'), WHATSAPP_MODE: 'simulate', WHATSAPP_POLL_MS: '3600000' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let diagnostics = ''
child.stdout.on('data', () => {})
child.stderr.on('data', (data) => { diagnostics += data.toString() })
const base = `http://127.0.0.1:${port}`
try {
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Servidor terminó: ${diagnostics.slice(-1000)}`)
    if (await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)) { ready = true; break }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!ready) throw new Error('Servidor no inició.')
  const headers = { Authorization: `Basic ${Buffer.from(`smoke:${password}`).toString('base64')}` }
  for (const [path, auth, expected] of [
    ['/', false, 401], ['/api/quotes', false, 401],
    ['/', true, 200], ['/cotizar', true, 200], ['/app/precios', true, 200],
    ['/api/no-existe', true, 404], ['/no-existe.js', true, 404],
    ['/api/channels/whatsapp/webhook', false, 403],
  ]) {
    const response = await fetch(`${base}${path}`, { headers: auth ? headers : {} })
    if (response.status !== expected) throw new Error(`${path}: esperaba ${expected}, recibió ${response.status}`)
    console.log(`PASS ${path}: ${response.status}`)
  }
} finally {
  child.kill()
}
