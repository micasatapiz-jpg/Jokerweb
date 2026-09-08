import eventosHero from '../assets/heroes/eventos-photo-v1.webp'
import granFormatoHero from '../assets/heroes/gran-formato-photo-v1.webp'
import letras3dHero from '../assets/heroes/letras-3d-photo-v1.webp'
import senaleticaHero from '../assets/heroes/senaletica-photo-v1.webp'
import vinilesHero from '../assets/heroes/viniles-photo-v1.webp'

const productImages = {
  ...import.meta.glob('../assets/productos/letras-3d/*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../assets/productos/gran-formato/*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../assets/productos/viniles/*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../assets/productos/senaletica/*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../assets/productos/eventos/*.webp', { eager: true, query: '?url', import: 'default' }),
}

function imageFor(path) {
  return productImages[`../assets/productos/${path}`]
}

export const productFamilies = {
  'letras-3d': {
    hero: letras3dHero,
    eyebrow: 'Letras corpóreas 3D',
    title: 'Volumen que convierte un nombre en presencia.',
    description: 'Fabricamos letras con cuerpo, textura y luz para interiores, fachadas y espacios comerciales.',
    message: 'Hola Joker 👋 Quisiera cotizar letras corpóreas 3D.',
    products: [
      ['Acrílico', 'Frentes brillantes o translúcidos con cantos pulidos y una presencia contemporánea.', 'letras-3d/acrilico-photo-v1.webp', '#ef445f', '#5536b8'],
      ['PVC', 'Letras ligeras, precisas y versátiles para aplicaciones interiores o exteriores.', 'letras-3d/pvc-photo-v1.webp', '#2468ff', '#58b7ff'],
      ['MDF', 'Volumen cálido y acabados personalizados para interiores con carácter.', 'letras-3d/mdf-photo-v1.webp', '#b56f3f', '#3b251d'],
      ['Metal', 'Acero o aluminio con acabados cepillados, pulidos y de alta durabilidad.', 'letras-3d/metal-photo-v1.webp', '#9ba7b7', '#303747'],
      ['Iluminadas', 'Frente luminoso uniforme para máxima visibilidad de día y de noche.', 'letras-3d/iluminadas-photo-v1.webp', '#7d2cff', '#00c8ff'],
      ['Retroiluminadas', 'Un halo posterior elegante que separa cada letra de la superficie.', 'letras-3d/retroiluminadas-photo-v1.webp', '#d7a53b', '#7a4622'],
    ],
  },
  'gran-formato': {
    hero: granFormatoHero,
    eyebrow: 'Gigantografías y banners',
    title: 'Ideas grandes, impresas para dominar el espacio.',
    description: 'Producimos gráficas de gran formato con color, definición y soportes adecuados para cada campaña.',
    message: 'Hola Joker 👋 Quisiera cotizar una impresión en gran formato.',
    products: [
      ['Banners', 'Formatos enrollables y portátiles para comunicar con rapidez en cualquier espacio.', 'gran-formato/banners-photo-v1.webp', '#ff664a', '#202f6b'],
      ['Gigantografías', 'Impresión de gran impacto para superficies extensas y alta exposición.', 'gran-formato/gigantografias-photo-v1.webp', '#ff8f25', '#005bbf'],
      ['Campañas', 'Piezas coordinadas para mantener una identidad consistente en distintos soportes.', 'gran-formato/campanas-photo-v1.webp', '#9f294f', '#ef9a80'],
      ['Eventos', 'Fondos y gráficas tensadas que presentan tu marca con un acabado profesional.', 'gran-formato/eventos-photo-v1.webp', '#00a079', '#103f4d'],
      ['Fachadas', 'Gráficas de gran escala preparadas para revestir y transformar exteriores.', 'gran-formato/fachadas-photo-v1.webp', '#ff6b19', '#174ed3'],
      ['Gran formato', 'Lonas tensadas y soluciones a medida para proyectos de dimensiones especiales.', 'gran-formato/gran-formato-photo-v1.webp', '#e14335', '#652094'],
    ],
  },
  viniles: {
    hero: vinilesHero,
    eyebrow: 'Viniles publicitarios',
    title: 'Cada superficie puede contar la historia de tu marca.',
    description: 'Imprimimos, cortamos y aplicamos viniles para vitrinas, muros, vehículos y comunicación comercial.',
    message: 'Hola Joker 👋 Quisiera cotizar un trabajo en vinil publicitario.',
    products: [
      ['Adhesivo', 'Color intenso y adherencia confiable para múltiples superficies lisas.', 'viniles/adhesivo-photo-v1.webp', '#f1c928', '#e74438'],
      ['Microperforado', 'Comunicación visible desde fuera que conserva visibilidad desde el interior.', 'viniles/microperforado-photo-v1.webp', '#a13cf2', '#ff7427'],
      ['Transparente', 'Gráficas ligeras y elegantes que aprovechan la transparencia del soporte.', 'viniles/transparente-photo-v1.webp', '#20a976', '#ef9c36'],
      ['Vitrinas', 'Composiciones que convierten vidrios y escaparates en puntos de atracción.', 'viniles/vitrinas-photo-v1.webp', '#ef6a5b', '#183866'],
      ['Muros', 'Murales adhesivos para transformar ambientes sin obras complejas.', 'viniles/muros-photo-v1.webp', '#497a55', '#c87345'],
      ['Rotulado', 'Identidad móvil para vehículos comerciales, flotas y unidades de reparto.', 'viniles/rotulado-photo-v1.webp', '#254de0', '#97db33'],
    ],
  },
  senaletica: {
    hero: senaleticaHero,
    eyebrow: 'Señalética',
    title: 'Orientar también es construir una buena experiencia.',
    description: 'Creamos sistemas claros, resistentes y coherentes con la identidad de cada espacio.',
    message: 'Hola Joker 👋 Quisiera cotizar un proyecto de señalética.',
    products: [
      ['Comercial', 'Dirección y comunicación visual para tiendas, centros comerciales y atención al público.', 'senaletica/comercial-photo-v1.webp', '#df6453', '#166751'],
      ['Corporativa', 'Sistemas sobrios y consistentes para oficinas, instituciones y empresas.', 'senaletica/corporativa-photo-v1.webp', '#ad7d4f', '#51473e'],
      ['Informativa', 'Información esencial presentada con jerarquía, contraste y lectura inmediata.', 'senaletica/informativa-photo-v1.webp', '#f2bf31', '#263968'],
      ['Interior', 'Placas, directorios y señales suspendidas integradas a la arquitectura.', 'senaletica/interior-photo-v1.webp', '#b98a59', '#292a2d'],
      ['Exterior', 'Tótems y señales preparadas para clima, distancia y exposición continua.', 'senaletica/exterior-photo-v1.webp', '#f36e25', '#164fa5'],
    ],
  },
  eventos: {
    hero: eventosHero,
    eyebrow: 'Publicidad para eventos',
    title: 'Una puesta en escena que hace recordar tu marca.',
    description: 'Diseñamos y producimos elementos transportables para ferias, activaciones y presentaciones.',
    message: 'Hola Joker 👋 Quisiera cotizar publicidad para un evento.',
    products: [
      ['Roll screen', 'Exhibidor portátil, rápido de montar y listo para acompañar cada presentación.', 'eventos/roll-screen-photo-v1.webp', '#11bdd5', '#7738e9'],
      ['Backing', 'Fondos amplios y continuos para fotografías, escenarios y activaciones.', 'eventos/backing-photo-v1.webp', '#9d3154', '#e5ae8a'],
      ['Displays', 'Soportes con volumen para destacar campañas, muestras y promociones.', 'eventos/displays-photo-v1.webp', '#ff7840', '#2853d8'],
      ['Paneles', 'Sistemas modulares que organizan el espacio y presentan contenido a gran escala.', 'eventos/paneles-photo-v1.webp', '#ef3d9b', '#202124'],
      ['Promocionales', 'Piezas coordinadas que extienden la experiencia de marca durante el evento.', 'eventos/promocionales-photo-v1.webp', '#e93f52', '#15876f'],
    ],
  },
}

export function getProductFamily(slug) {
  const family = productFamilies[slug]
  if (!family) return null

  return {
    ...family,
    slug,
    products: family.products.map(([name, description, imagePath, colorA, colorB]) => ({
      name,
      description,
      image: imageFor(imagePath),
      colorA,
      colorB,
    })),
  }
}
