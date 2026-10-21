import cajaLuz from '../assets/productos/letreros/caja-luz-photo-v1.webp'
import bastidor from '../assets/productos/letreros/bastidor-publicitario-photo-v1.webp'
import valla from '../assets/valla-publicitaria-v3.webp'
import acrilico from '../assets/acrilico-v2.webp'
import mdf from '../assets/mdf-v2.webp'
import metal from '../assets/metal-v2.webp'
import { catalogSignGroups } from './catalogoLetreros'
import refreshedBanner from '../assets/banners-v2.webp'
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
    description: 'Letras y logotipos con volumen en PVC, acrílico, MDF y metal. Opciones sin iluminación, con luz frontal o con halo posterior.',
    message: whatsappMessages.letras3d,
    products: [
      ['PVC sin iluminación', 'Letras y logotipos con relieve, pintados según el diseño. Espesor y fijación según la superficie y el lugar de uso.', 'letras-3d/pvc-photo-v1.webp', '#24cbbb', '#12122c', 'Imagen referencial del acabado'],
      ['Acrílico sin iluminación', 'Letras y logotipos con volumen en acrílico. Color, espesor y acabado se definen según el diseño.', acrilico, '#24cbbb', '#12122c', 'Imagen referencial del acabado'],
      ['MDF para interiores', 'Letras con relieve para interiores y decoración comercial. No se recomienda su exposición directa a lluvia o humedad.', mdf, '#24cbbb', '#12122c', 'Imagen referencial del acabado'],
      ['Metal sin iluminación', 'Letras y logotipos con volumen en metal. Material, acabado y protección se especifican según el ambiente.', metal, '#24cbbb', '#12122c', 'Imagen referencial del acabado'],
      ...catalogSignGroups[0].products.map((product) => [product.name, product.description, product.image, product.colorA, product.colorB, product.caption]),
    ],
  },
  letreros: {
    hero: cajaLuz,
    eyebrow: 'Letreros y estructuras publicitarias',
    title: 'Cajas de luz, bastidores y vallas para tu publicidad.',
    description: 'Letreros con un frente gráfico y una estructura de soporte: cajas de luz, bastidores y vallas publicitarias. Las letras y logotipos con volumen se encuentran en Letras corpóreas 3D.',
    message: whatsappMessages.letreros,
    products: [
      ['Cajas de luz', 'Cajones luminosos con un frente gráfico e iluminación interior. Medidas, material del frente y sistema de montaje según el proyecto.', cajaLuz, '#24cbbb', '#12122c', 'Imagen referencial del producto'],
      ['Letreros con bastidor', 'Gráficas montadas sobre un bastidor para fachadas y anuncios. La cotización distingue impresión, estructura y montaje.', bastidor, '#24cbbb', '#12122c', 'Imagen referencial del producto'],
      ['Vallas publicitarias', 'Anuncios de gran formato con estructura de soporte. Revisamos ubicación, dimensiones, altura y condiciones de montaje antes de cotizar.', valla, '#24cbbb', '#12122c', 'Montaje referencial generado con IA'],
    ],
  },
  'neon-led': {
    hero: catalogSignGroups[1].products[0].image,
    eyebrow: 'Neón LED y espejos infinitos',
    title: 'Trazos de luz y efectos para tu espacio.',
    description: 'Logotipos, frases, siluetas, cuadros y alas en neón LED, además de espejos con efecto infinito. Una familia de iluminación decorativa y de marca.',
    message: 'Hola, Joker. Quisiera cotizar neón LED o un espejo infinito.',
    products: catalogSignGroups.slice(1).flatMap(group => group.products).map(product => [product.name, product.description, product.image, product.colorA, product.colorB, product.caption]),
  },
  'gran-formato': {
    hero: granFormatoHero,
    eyebrow: 'Banners y gigantografías',
    title: 'Impresión en lona, a la medida de tu mensaje.',
    description: 'Banners y gigantografías son impresiones en lona de diferentes tamaños. Las preparamos para promociones, campañas y fachadas; acabados, estructura y montaje se detallan en la cotización.',
    message: whatsappMessages.granFormato,
    products: [
      ['Banners en lona', 'Gráficas en lona para promociones y aperturas. Las medidas y sujeción se definen según el lugar; no incluyen un exhibidor roll screen.', 'gran-formato/banners-photo-v1.webp', '#ff664a', '#202f6b'],
      ['Gigantografías', 'Gráficas de gran tamaño para muros, estructuras y campañas. Comparte medidas y distancia de lectura para definir el diseño.', 'gran-formato/gigantografias-photo-v1.webp', '#ff8f25', '#005bbf'],
    ],
  },
  viniles: {
    hero: vinilesHero,
    eyebrow: 'Viniles y rotulado',
    productsTitle: 'Tipos de vinil',
    applicationsTitle: 'Aplicaciones del vinil',
    title: 'Cada superficie puede contar la historia de tu marca.',
    description: 'Imprimimos, cortamos y aplicamos viniles para vitrinas, muros, vehículos y comunicación comercial.',
    message: whatsappMessages.viniles,
    products: [
      ['Vinil adhesivo impreso', 'Gráficas autoadhesivas para promociones y superficies lisas. Revisamos el soporte y el uso para definir el vinil.', 'viniles/adhesivo-photo-v1.webp', '#f1c928', '#e74438'],
      ['Vinil microperforado', 'Vinil perforado para vidrio. La visibilidad desde el interior depende de la luz a ambos lados; no ofrece privacidad total.', 'viniles/microperforado-photo-v1.webp', '#a13cf2', '#ff7427'],
      ['Vinil transparente', 'Vinil transparente para gráficos sobre vidrio. La lectura y los colores dependen del soporte y la iluminación.', 'viniles/transparente-photo-v1.webp', '#20a976', '#ef9c36'],
    ],
    applications: [
      ['Rotulado de vitrinas', 'Gráficas para escaparates, horarios y promociones. Define cuánto vidrio cubrir y qué zonas deben conservar transparencia.', 'viniles/vitrinas-photo-v1.webp', '#ef6a5b', '#183866'],
      ['Vinil para muros', 'Gráficas adhesivas para interiores. La humedad, la textura o la pintura suelta del muro pueden afectar la adherencia.', 'viniles/muros-photo-v1.webp', '#497a55', '#c87345'],
      ['Rotulado vehicular', 'Gráficas para vehículos comerciales. Envía modelo, fotos y zonas a cubrir; el estado de la pintura influye en la aplicación.', 'viniles/rotulado-photo-v1.webp', '#254de0', '#97db33'],
    ],
  },
  senaletica: {
    hero: senaleticaHero,
    eyebrow: 'Señalética y directorios',
    title: 'Orientar también es construir una buena experiencia.',
    description: 'Placas para identificar ambientes, directorios para ubicar áreas, señales para orientar y tótems para exteriores. Materiales y fijación según el espacio.',
    message: whatsappMessages.senaletica,
    products: [
      ['Placas de identificación', 'Identificación de oficinas y ambientes con tu identidad de marca. Comparte la lista de espacios y cantidades.', 'senaletica/corporativa-photo-v1.webp', '#ad7d4f', '#51473e'],
      ['Directorios', 'Mensajes y directorios para orientar al visitante. Información, contraste y tamaño según la distancia de lectura.', 'senaletica/informativa-photo-v1.webp', '#f2bf31', '#263968'],
      ['Señales de orientación', 'Flechas, pictogramas e indicaciones para recorridos y servicios. Definimos mensajes, tamaño y fijación según el punto de colocación.', 'senaletica/interior-photo-v1.webp', '#b98a59', '#292a2d'],
      ['Tótems de orientación', 'Elementos verticales para identificar accesos y orientar desde el exterior. Clima, distancia y ubicación determinan material y estructura.', 'senaletica/exterior-photo-v1.webp', '#f36e25', '#164fa5'],
    ],
  },
  eventos: {
    hero: eventosHero,
    eyebrow: 'Exhibidores y gráficas para eventos',
    title: 'Una puesta en escena que hace recordar tu marca.',
    description: 'Diseñamos y producimos elementos transportables para ferias, activaciones y presentaciones.',
    message: whatsappMessages.eventos,
    products: [
      ['Roll screens', 'Exhibidor enrollable para ferias y presentaciones. Confirma si necesitas el sistema completo o renovar la impresión de uno existente.', 'eventos/roll-screen-photo-v1.webp', '#11bdd5', '#7738e9'],
      ['Backings', 'Fondo de marca para fotos y eventos. Indica medidas y si requieres impresión, estructura, traslado o montaje.', 'eventos/backing-photo-v1.webp', '#9d3154', '#e5ae8a'],
      ['Displays', 'Exhibidores para destacar productos y promociones. Forma, material y estabilidad según el uso.', 'eventos/displays-photo-v1.webp', '#ff7840', '#2853d8'],
      ['Paneles para exposición', 'Paneles gráficos para informar o dividir zonas en eventos. Consulta opciones de soporte, transporte y montaje.', 'eventos/paneles-photo-v1.webp', '#ef3d9b', '#202124'],
    ],
  },
}

export function getProductFamily(slug) {
  const family = productFamilies[slug]
  if (!family) return null

  return {
    ...family,
    slug,
    products: family.products.map(toProduct),
    applications: (family.applications || []).map(toProduct),
  }
}

function toProduct([name, description, imagePath, colorA, colorB, caption]) {
  return {
      name,
      description,
      image: imageFor(imagePath),
      colorA,
      colorB,
      caption,
  }
}





