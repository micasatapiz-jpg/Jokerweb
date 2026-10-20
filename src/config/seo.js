export const DEFAULT_SITE_URL = 'https://jokerperu3d.com'

export const publicPages = {
  "/": {
    "title": "Letreros publicitarios y letras 3D en Lima | Joker",
    "description": "Letreros luminosos, letras 3D, gigantografías, viniles y señalética para negocios en Lima. Envíos a todo el Perú. Instalación previa coordinación. Cotiza por WhatsApp."
  },
  "/catalogo": {
    "title": "Publicidad e impresión para negocios en Lima | Joker",
    "description": "Servicios de publicidad en Lima: letreros, letras corpóreas 3D, gigantografías, banners, viniles, señalética y piezas para eventos. Cotiza con Joker."
  },
  "/servicios/letreros": {
    "title": "Letreros luminosos y publicitarios en Lima | Joker",
    "description": "Letras corpóreas iluminadas, neón LED personalizado y espejos infinitos en Lima. Logos, frases, siluetas y alas para fotos. Envíos a todo el Perú."
  },
  "/servicios/letras-3d": {
    "title": "Letras 3D y letras corpóreas en Lima | Joker",
    "description": "Letras corpóreas en PVC y acrílico con luz frontal, acrílico iluminado, PVC y aluminio retroiluminados. Fabricación a medida. Cotiza con Joker."
  },
  "/servicios/gran-formato": {
    "title": "Gigantografías y banners en Lima | Joker",
    "description": "Impresión de gigantografías, banners y gráficas de gran formato para campañas, fachadas y eventos en Lima. Cotiza tu proyecto con Joker."
  },
  "/servicios/viniles": {
    "title": "Viniles publicitarios y rotulado en Lima | Joker",
    "description": "Viniles adhesivos, microperforados y transparentes para vitrinas, muros y vehículos en Lima. Diseño y rotulado para tu negocio. Cotiza con Joker."
  },
  "/servicios/senaletica": {
    "title": "Señalética comercial y corporativa en Lima | Joker",
    "description": "Señalética informativa, corporativa y comercial para oficinas y negocios en Lima. Placas, directorios y señales para interiores y exteriores."
  },
  "/servicios/eventos": {
    "title": "Publicidad para eventos y backings en Lima | Joker",
    "description": "Backings, roll screens, displays, paneles y promocionales para ferias, activaciones y eventos en Lima. Diseño y producción con Joker."
  },
  "/nosotros": {
    "title": "Diseño y producción publicitaria para Lima | Joker",
    "description": "Conoce a Joker: diseño, fabricación e instalación de piezas publicitarias para negocios en Lima. Atención desde Lima y envíos a todo el Perú."
  },
  "/contacto": {
    "title": "Cotiza publicidad y letreros en Lima | Joker",
    "description": "Cotiza letreros, letras 3D, gigantografías, viniles y señalética para tu negocio en Lima. Contacta a Joker por WhatsApp al +51 972 044 482."
  },
  "/politica-privacidad": {
    "title": "Política de privacidad | Joker",
    "description": "Conoce cómo Joker trata los datos personales recibidos en el sitio web y sus canales de atención y cotización."
  }
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
    areaServed: [
      { '@type': 'City', name: 'Lima', containedInPlace: { '@type': 'Country', name: 'Perú' } },
      { '@type': 'Country', name: 'Perú' },
    ],
    sameAs: ['https://www.instagram.com/joker.publicidadcreativa/', 'https://www.tiktok.com/@jokerstudio.pe', 'https://www.facebook.com/Jokerstudiopublicitario'],
    telephone: '+51972044482', email: 'jokerstudio.pe@gmail.com',
    contactPoint: { '@type': 'ContactPoint', telephone: '+51972044482', contactType: 'customer service', availableLanguage: 'Spanish' },
  }
}




