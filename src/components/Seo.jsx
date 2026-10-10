import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { normalizeSiteUrl, organizationSchema, pageSeo } from '../config/seo'

const siteUrl = normalizeSiteUrl(import.meta.env.VITE_SITE_URL || '')

export default function Seo() {
  const { pathname } = useLocation()
  useEffect(() => {
    const meta = pageSeo(pathname, siteUrl)
    document.title = meta.title
    const setMeta = (key, value, attribute = 'name') => {
      let tag = document.head.querySelector(`meta[${attribute}="${key}"]`)
      if (!tag) { tag = document.createElement('meta'); tag.setAttribute(attribute, key); document.head.append(tag) }
      tag.content = value
    }
    setMeta('description', meta.description)
    setMeta('robots', meta.robots)
    setMeta('og:title', meta.title, 'property')
    setMeta('og:description', meta.description, 'property')
    setMeta('og:type', 'website', 'property')
    setMeta('og:site_name', 'Joker', 'property')
    setMeta('og:locale', 'es_PE', 'property')
    let canonical = document.head.querySelector('link[rel="canonical"]')
    if (meta.canonical) {
      if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical) }
      canonical.href = meta.canonical
      setMeta('og:url', meta.canonical, 'property')
    } else {
      canonical?.remove()
      document.head.querySelector('meta[property="og:url"]')?.remove()
    }
    let schema = document.getElementById('joker-organization')
    if (meta.robots.startsWith('index')) {
      if (!schema) { schema = document.createElement('script'); schema.id = 'joker-organization'; schema.type = 'application/ld+json'; document.head.append(schema) }
      schema.textContent = JSON.stringify(organizationSchema(siteUrl))
    } else schema?.remove()
  }, [pathname])
  return null
}
