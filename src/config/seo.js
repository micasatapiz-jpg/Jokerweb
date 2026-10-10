export const publicPages = {
  '/': { title: 'Joker | Letreros, letras 3D e impresión publicitaria en Perú', description: 'Diseñamos, fabricamos e instalamos letreros, letras 3D, banners, viniles y señalética. Haz visible tu marca con Joker y cotiza por WhatsApp.' },
  '/catalogo': { title: 'Servicios de publicidad e impresión | Joker', description: 'Conoce nuestros letreros, letras corpóreas 3D, gigantografías, banners, viniles, señalética y publicidad para eventos. Cotiza con Joker.' },
  '/servicios/letreros': { title: 'Letreros luminosos y publicitarios | Joker', description: 'Letreros LED, cajas de luz, acrílico, retroiluminados y fachadas comerciales. Diseño, fabricación e instalación para tu negocio. Cotiza con Joker.' },
  '/servicios/letras-3d': { title: 'Letras corpóreas 3D en acrílico, PVC y metal | Joker', description: 'Letras 3D en acrílico, PVC, MDF y metal, iluminadas o retroiluminadas. Dale volumen y presencia al nombre de tu marca. Cotiza con Joker.' },
  '/servicios/gran-formato': { title: 'Gigantografías, banners e impresión de gran formato | Joker', description: 'Impresión de banners, gigantografías y gráficas para campañas, fachadas y eventos. Color y formatos a medida para tu proyecto. Cotiza con Joker.' },
  '/servicios/viniles': { title: 'Viniles publicitarios y rotulado | Joker', description: 'Viniles adhesivos, microperforados y transparentes para vitrinas, muros y vehículos. Impresión y aplicación para tu marca. Cotiza con Joker.' },
  '/servicios/senaletica': { title: 'Señalética comercial y corporativa | Joker', description: 'Señalética informativa, corporativa y comercial para interiores y exteriores. Orientación clara y acabados para cada espacio. Cotiza con Joker.' },
  '/servicios/eventos': { title: 'Publicidad para eventos: backings y roll screens | Joker', description: 'Backings, roll screens, displays, paneles y promocionales para ferias y eventos. Haz destacar tu marca con Joker. Cotiza por WhatsApp.' },
  '/nosotros': { title: 'Diseño, producción e instalación publicitaria | Joker', description: 'Conoce a Joker: un equipo creativo y de producción publicitaria. Diseñamos, fabricamos e instalamos piezas para hacer visible tu marca.' },
  '/contacto': { title: 'Contacto y cotizaciones por WhatsApp | Joker', description: 'Cuéntanos tu proyecto publicitario. Contacta a Joker por WhatsApp al +51 972 044 482 para cotizar letreros, impresión, viniles y señalética.' },
  '/politica-privacidad': { title: 'Política de privacidad | Joker', description: 'Conoce cómo Joker trata los datos personales recibidos en el sitio web y sus canales de atención y cotización.' },
}

export function normalizeSiteUrl(value = '') {
  if (!value.trim()) return ''
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_SITE_URL debe ser el dominio público HTTPS, sin rutas ni parámetros.')
  }
  return url.origin
}

export function pageSeo(pathname, siteUrl = '') {
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/'
  const page = publicPages[path]
  return {
    ...(page || { title: 'Joker', description: 'Joker: producción publicitaria y atención por WhatsApp.' }),
    robots: page ? 'index,follow' : 'noindex,follow',
    canonical: page && siteUrl ? siteUrl + (path === '/' ? '/' : path) : '',
  }
}

export function organizationSchema(siteUrl) {
  return {
    '@context': 'https://schema.org', '@type': 'Organization', name: 'Joker',
    ...(siteUrl ? { url: siteUrl + '/' } : {}),
    telephone: '+51972044482', email: 'jokerstudio.pe@gmail.com',
    contactPoint: { '@type': 'ContactPoint', telephone: '+51972044482', contactType: 'customer service', availableLanguage: 'Spanish' },
  }
}
