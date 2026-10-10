import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { normalizeSiteUrl, organizationSchema, pageSeo, publicPages } from '../src/config/seo.js'

const escape = (text) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const markers = /<!-- joker-seo:start -->[\s\S]*?<!-- joker-seo:end -->/

export function seoHead(pathname, siteUrl) {
  const meta = pageSeo(pathname, siteUrl)
  const tags = [
    `<title>${escape(meta.title)}</title>`,
    `<meta name="description" content="${escape(meta.description)}">`,
    `<meta name="robots" content="${meta.robots}">`,
    `<meta property="og:title" content="${escape(meta.title)}">`,
    `<meta property="og:description" content="${escape(meta.description)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Joker">',
    '<meta property="og:locale" content="es_PE">',
  ]
  if (meta.canonical) tags.push(`<link rel="canonical" href="${escape(meta.canonical)}">`, `<meta property="og:url" content="${escape(meta.canonical)}">`)
  if (meta.robots.startsWith('index')) tags.push(`<script id="joker-organization" type="application/ld+json">${JSON.stringify(organizationSchema(siteUrl)).replace(/</g, '\\u003c')}</script>`)
  return '<!-- joker-seo:start -->\n' + tags.join('\n') + '\n<!-- joker-seo:end -->'
}

export function seoPlugin(url) {
  const siteUrl = normalizeSiteUrl(url)
  let output
  return {
    name: 'joker-seo',
    configResolved(config) { output = resolve(config.root, config.build.outDir) },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) { return html.replace(markers, seoHead(context.originalUrl || '/', siteUrl)) },
    },
    async writeBundle() {
      const template = await readFile(resolve(output, 'index.html'), 'utf8')
      for (const path of Object.keys(publicPages).filter((path) => path !== '/')) {
        const directory = resolve(output, path.slice(1))
        await mkdir(directory, { recursive: true })
        await writeFile(resolve(directory, 'index.html'), template.replace(markers, seoHead(path, siteUrl)))
      }
      const robots = 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\nDisallow: /propuesta-visual\n'
      await writeFile(resolve(output, 'robots.txt'), robots + (siteUrl ? `Sitemap: ${siteUrl}/sitemap.xml\n` : ''))
      if (siteUrl) {
        const urls = Object.keys(publicPages).map((path) => `<url><loc>${escape(pageSeo(path, siteUrl).canonical)}</loc></url>`).join('\n')
        await writeFile(resolve(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`)
      }
    },
  }
}
