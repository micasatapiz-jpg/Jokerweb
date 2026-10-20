import { catalogSignGroups } from './catalogoLetreros'
import refreshedBanner from '../assets/banners-v2.webp'
import refreshedFacade from '../assets/fachada-v2.webp'
import refreshedVehicle from '../assets/rotulado-v2.webp'
import refreshedCorporate from '../assets/corporativa-v2.webp'
import { whatsappMessages } from './siteConfig'
import eventosHero from '../assets/hero-eventos-v2.webp'
import granFormatoHero from '../assets/hero-gran-formato-v2.webp'
import senaleticaHero from '../assets/hero-senaletica-v2.webp'
import vinilesHero from '../assets/hero-viniles-v2.webp'

const productImages = {
  ...import.meta.glob('../assets/productos/letras-3d/*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../assets/productos/gran-formato/*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../assets/productos/viniles/*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../assets/productos/senaletica/*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../assets/productos/eventos/*.webp', { eager: true, query: '?url', import: 'default' }),
}

const refreshedImages = {
  'gran-formato/banners-photo-v1.webp': refreshedBanner,
  'gran-formato/fachadas-photo-v1.webp': refreshedFacade,
  'viniles/rotulado-photo-v1.webp': refreshedVehicle,
  'senaletica/corporativa-photo-v1.webp': refreshedCorporate,
}

function imageFor(path) {
  return refreshedImages[path] || productImages[`../assets/productos/${path}`] || path
}

export const productFamilies = {
  'letras-3d': {
    hero: catalogSignGroups[0].products[0].image,
    eyebrow: 'Letras corpóreas 3D',
    title: 'Letras corpóreas con la luz y el acabado de tu marca.',
    description: 'Fabricamos letras corpóreas en PVC y acrílico con luz frontal, acrílico iluminado, PVC retroiluminado y aluminio retroiluminado.',
    message: whatsappMessages.letras3d,
    products: catalogSignGroups[0].products.map((product) => [product.name, product.description, product.image, product.colorA, product.colorB, product.caption]),
  },
  'gran-formato': {
    hero: granFormatoHero,
    eyebrow: 'Gigantografías y banners',
    title: 'Ideas grandes, impresas para dominar el espacio.',
    description: 'Producimos gráficas de gran formato con color, definición y soportes adecuados para cada campaña.',
    message: whatsappMessages.granFormato,
    products: [
      ['Banners', 'Gráficas en lona para promociones y aperturas. Las medidas y sujeción se definen según el lugar; no incluyen un exhibidor roll screen.', 'gran-formato/banners-photo-v1.webp', '#ff664a', '#202f6b'],
      ['Gigantografías', 'Gráficas de gran tamaño para muros, estructuras y campañas. Comparte medidas y distancia de lectura para definir el diseño.', 'gran-formato/gigantografias-photo-v1.webp', '#ff8f25', '#005bbf'],
      ['Campañas', 'Gráficas coordinadas para promociones o lanzamientos. Adaptamos el mensaje a los formatos y cantidades de tu campaña.', 'gran-formato/campanas-photo-v1.webp', '#9f294f', '#ef9a80'],
      ['Eventos', 'Fondos y gráficas para ferias y activaciones. Indica si necesitas solo la impresión o también estructura y montaje.', 'gran-formato/eventos-photo-v1.webp', '#00a079', '#103f4d'],
      ['Fachadas', 'Gráficas para anunciar tu negocio desde el exterior. La superficie, exposición y fijación se revisan antes de producir.', 'gran-formato/fachadas-photo-v1.webp', '#ff6b19', '#174ed3'],
      ['Gran formato', 'Impresiones a medida para dimensiones especiales. Consulta el material, las uniones y el soporte adecuados a tu espacio.', 'gran-formato/gran-formato-photo-v1.webp', '#e14335', '#652094'],
    ],
  },
  viniles: {
    hero: vinilesHero,
    eyebrow: 'Viniles publicitarios',
    title: 'Cada superficie puede contar la historia de tu marca.',
    description: 'Imprimimos, cortamos y aplicamos viniles para vitrinas, muros, vehículos y comunicación comercial.',
    message: whatsappMessages.viniles,
    products: [
      ['Adhesivo', 'Gráficas autoadhesivas para promociones y superficies lisas. Revisamos el soporte y el uso para definir el vinil.', 'viniles/adhesivo-photo-v1.webp', '#f1c928', '#e74438'],
      ['Microperforado', 'Vinil perforado para vidrio. La visibilidad desde el interior depende de la luz a ambos lados; no ofrece privacidad total.', 'viniles/microperforado-photo-v1.webp', '#a13cf2', '#ff7427'],
      ['Transparente', 'Vinil transparente para gráficos sobre vidrio. La lectura y los colores dependen del soporte y la iluminación.', 'viniles/transparente-photo-v1.webp', '#20a976', '#ef9c36'],
      ['Vitrinas', 'Gráficas para escaparates, horarios y promociones. Define cuánto vidrio cubrir y qué zonas deben conservar transparencia.', 'viniles/vitrinas-photo-v1.webp', '#ef6a5b', '#183866'],
      ['Muros', 'Gráficas adhesivas para interiores. La humedad, la textura o la pintura suelta del muro pueden afectar la adherencia.', 'viniles/muros-photo-v1.webp', '#497a55', '#c87345'],
      ['Rotulado', 'Gráficas para vehículos comerciales. Envía modelo, fotos y zonas a cubrir; el estado de la pintura influye en la aplicación.', 'viniles/rotulado-photo-v1.webp', '#254de0', '#97db33'],
    ],
  },
  senaletica: {
    hero: senaleticaHero,
    eyebrow: 'Señalética',
    title: 'Orientar también es construir una buena experiencia.',
    description: 'Creamos sistemas claros, resistentes y coherentes con la identidad de cada espacio.',
    message: whatsappMessages.senaletica,
    products: [
      ['Comercial', 'Señales para ubicar zonas y servicios en tiendas. Textos y tamaños según el recorrido del cliente.', 'senaletica/comercial-photo-v1.webp', '#df6453', '#166751'],
      ['Corporativa', 'Identificación de oficinas y ambientes con tu identidad de marca. Comparte la lista de espacios y cantidades.', 'senaletica/corporativa-photo-v1.webp', '#ad7d4f', '#51473e'],
      ['Informativa', 'Mensajes y directorios para orientar al visitante. Información, contraste y tamaño según la distancia de lectura.', 'senaletica/informativa-photo-v1.webp', '#f2bf31', '#263968'],
      ['Interior', 'Placas y directorios para pasillos, puertas y recepciones. El soporte y la fijación dependen de la superficie.', 'senaletica/interior-photo-v1.webp', '#b98a59', '#292a2d'],
      ['Exterior', 'Señales y tótems para orientar desde el exterior. Clima, distancia y ubicación determinan material y estructura.', 'senaletica/exterior-photo-v1.webp', '#f36e25', '#164fa5'],
    ],
  },
  eventos: {
    hero: eventosHero,
    eyebrow: 'Publicidad para eventos',
    title: 'Una puesta en escena que hace recordar tu marca.',
    description: 'Diseñamos y producimos elementos transportables para ferias, activaciones y presentaciones.',
    message: whatsappMessages.eventos,
    products: [
      ['Roll screen', 'Exhibidor enrollable para ferias y presentaciones. Confirma si necesitas el sistema completo o renovar la impresión de uno existente.', 'eventos/roll-screen-photo-v1.webp', '#11bdd5', '#7738e9'],
      ['Backing', 'Fondo de marca para fotos y eventos. Indica medidas y si requieres impresión, estructura, traslado o montaje.', 'eventos/backing-photo-v1.webp', '#9d3154', '#e5ae8a'],
      ['Displays', 'Exhibidores para destacar productos y promociones. Forma, material y estabilidad según el uso.', 'eventos/displays-photo-v1.webp', '#ff7840', '#2853d8'],
      ['Paneles', 'Paneles gráficos para informar o dividir zonas en eventos. Consulta opciones de soporte, transporte y montaje.', 'eventos/paneles-photo-v1.webp', '#ef3d9b', '#202124'],
      ['Promocionales', 'Piezas de apoyo para activaciones. Cuéntanos el artículo, cantidad y fecha para revisar opciones y disponibilidad.', 'eventos/promocionales-photo-v1.webp', '#e93f52', '#15876f'],
    ],
  },
}

export function getProductFamily(slug) {
  const family = productFamilies[slug]
  if (!family) return null

  return {
    ...family,
    slug,
    products: family.products.map(([name, description, imagePath, colorA, colorB, caption]) => ({
      name,
      description,
      image: imageFor(imagePath),
      colorA,
      colorB,
      caption,
    })),
  }
}



