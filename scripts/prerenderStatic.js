import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { publicPages } from '../src/config/seo.js'
import { NOT_FOUND_PATH } from './seoPlugin.js'

// Render the actual public React pages at build time, using the same content
// visitors see. No extra server, API, or animation downloads are needed to crawl.
const output = resolve('dist')
const manifest = JSON.parse(await readFile(resolve(output, '.vite/manifest.json'), 'utf8'))
const assets = Object.entries(manifest).filter(([source]) => source.startsWith('src/assets/'))
const server = await createServer({ server: { middlewareMode: true }, ssr: { noExternal: ['gsap'] } })
try {
  const { renderPage } = await server.ssrLoadModule('/scripts/prerender.jsx')
  for (const pathname of [...Object.keys(publicPages), NOT_FOUND_PATH]) {
    const file = pathname === NOT_FOUND_PATH ? resolve(output, '404.html') : resolve(output, pathname.slice(1), 'index.html')
    let markup = renderPage(pathname)
    for (const [source, asset] of assets) markup = markup.replaceAll('/' + source, '/' + asset.file)
    if (markup.includes('/src/assets/')) throw new Error(`Unresolved asset in ${pathname}`)
    const html = await readFile(file, 'utf8')
    if (!html.includes('<div id="root"></div>')) throw new Error(`Missing empty root in ${pathname}`)
    await writeFile(file, html.replace('<div id="root"></div>', `<div id="root">${markup}</div>`))
  }
  console.log(`Prerendered ${Object.keys(publicPages).length} public pages with visible content.`)
} finally {
  await server.close()
}
