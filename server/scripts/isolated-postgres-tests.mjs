import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'

// Native test binaries are installed in a separate temporary tooling directory, NOT
// a production dependency. No existing database or Docker volume is touched/deleted.
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = await realpath(process.argv[2] ?? '')
const temp = await realpath(tmpdir())
const relative = path.relative(temp, root)
if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('joker-pg-test-')) throw new Error('Use a dedicated joker-pg-test-* directory inside TEMP.')
const binaries = await import(pathToFileURL(path.join(root, 'node_modules/@embedded-postgres/windows-x64/dist/index.js')).href)
const cluster = path.join(root, `cluster-${randomUUID()}`)
const port = 55439
const env = { ...process.env, DATABASE_URL: `postgresql://joker_test@127.0.0.1:${port}/joker_core_test`,
  TEST_DATABASE_URL: `postgresql://joker_test@127.0.0.1:${port}/joker_core_test`, OPENAI_API_KEY: '', WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_MODE: 'simulate' }
const run = (exe, args, timeout = 120000) => new Promise((resolve, reject) => {
  const child = spawn(exe, args, { cwd: serverDir, env, windowsHide: true, stdio: 'inherit', timeout })
  child.on('error', reject)
  child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Test process failed: ${code ?? signal}`)))
})
let started = false
try {
  await run(binaries.initdb, ['-D', cluster, '-A', 'trust', '-U', 'joker_test', '--encoding=UTF8', '--locale=C'])
  await run(binaries.pg_ctl, ['-D', cluster, '-l', path.join(cluster, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'])
  started = true
  const client = new pg.Client({ host: '127.0.0.1', port, user: 'joker_test', database: 'postgres' })
  try {
    await client.connect()
    const result = await client.query("SELECT current_setting('data_directory') AS directory")
    if (path.resolve(result.rows[0].directory).toLowerCase() !== cluster.toLowerCase()) throw new Error('Unexpected database cluster; refusing to run tests.')
    await client.query('CREATE DATABASE joker_core_test')
  } finally { await client.end() }
  await run(process.execPath, [path.join(serverDir, 'node_modules/prisma/build/index.js'), 'db', 'push'])
  await run(process.execPath, [path.join(serverDir, 'node_modules/vitest/vitest.mjs'), 'run'])
} finally {
  if (started) await run(binaries.pg_ctl, ['-D', cluster, '-m', 'fast', '-w', 'stop'])
  console.log(`Isolated test files retained (server stopped): ${cluster}`)
}
