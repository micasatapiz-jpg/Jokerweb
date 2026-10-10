import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { normalizeSiteUrl, pageSeo, publicPages } from './seo.js'
import { seoPlugin } from '../../scripts/seoPlugin.js'

test('canonical URLs require a public HTTPS origin; private pages stay out of the index', () => {
  assert.equal(normalizeSiteUrl(''), '')
  assert.equal(normalizeSiteUrl('https://example.com/'), 'https://example.com')
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?key=value']) assert.throws(() => normalizeSiteUrl(url))
  assert.equal(pageSeo('/servicios/viniles/?source=ad', 'https://example.com').canonical, 'https://example.com/servicios/viniles')
  for (const path of ['/app', '/app/cotizaciones/123', '/propuesta-visual', '/desconocida']) {
    assert.equal(pageSeo(path, 'https://example.com').robots, 'noindex,follow')
    assert.equal(pageSeo(path, 'https://example.com').canonical, '')
  }
})

test('build emits route-specific metadata and a sitemap containing only public URLs', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'joker-seo-'))
  try {
    await mkdir(resolve(root, 'dist'))
    await writeFile(resolve(root, 'dist/index.html'), '<html><head><!-- joker-seo:start --><!-- joker-seo:end --></head><body><div id="root"></div></body></html>')
    const plugin = seoPlugin('https://example.com')
    plugin.configResolved({ root, build: { outDir: 'dist' } })
    await plugin.writeBundle()
    const sitemap = await readFile(resolve(root, 'dist/sitemap.xml'), 'utf8')
    assert.equal((sitemap.match(/<loc>/g) || []).length, Object.keys(publicPages).length)
    assert.ok(!sitemap.includes('/app') && !sitemap.includes('/propuesta-visual'))
    for (const [path, page] of Object.entries(publicPages).filter(([path]) => path !== '/')) {
      const html = await readFile(resolve(root, 'dist', path.slice(1), 'index.html'), 'utf8')
      assert.ok(html.includes(`<title>${page.title}</title>`), path)
      assert.ok(html.includes(`href="https://example.com${path}"`), path)
      assert.equal((html.match(/rel="canonical"/g) || []).length, 1)
      assert.ok(sitemap.includes(`https://example.com${path}</loc>`))
    }
    assert.ok((await readFile(resolve(root, 'dist/robots.txt'), 'utf8')).includes('Sitemap: https://example.com/sitemap.xml'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
