import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

// Keep the complete current packs and the final still used for reduced motion.
// Source frames and old packs stay in Git; they do not need to be publicly served.
export async function prepareStatic(output = resolve('dist')) {
  const manifest = JSON.parse(await readFile(new URL('../src/config/sequenceBundles.json', import.meta.url)))
  const allowed = new Set([
    'secuencias/joker/clip-03/frame-192.webp',
    ...['desktop', 'mobile'].flatMap((variant) => manifest[variant].map((pack) => pack.url.slice(1))),
  ])
  let files = 0
  let removed = 0
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) { await visit(path, relative + '/'); continue }
      if (relative.startsWith('secuencias/') && !allowed.has(relative)) {
        removed += (await stat(path)).size
        await rm(path)
      } else if (/\.(?:html|css|js|json|xml|txt|svg)$/.test(relative)) {
        await writeFile(path + '.gz', gzipSync(await readFile(path), { level: 9 }))
        files++
      }
    }
  }
  await visit(output)
  for (const path of allowed) await stat(resolve(output, path))
  console.log(`Static deploy: ${files} precompressed files; ${(removed / 1e6).toFixed(1)} MB of unused sequences excluded.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareStatic()
