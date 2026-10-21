import eventosImage from '../assets/hero-eventos-v2.webp'
import granFormatoImage from '../assets/hero-gran-formato-v2.webp'
import letrerosImage from '../assets/productos/letreros/caja-luz-photo-v1.webp'
import neonImage from '../assets/catalogo-neon-logotipos.webp'
import letras3dImage from '../assets/catalogo-pvc-acrilico-frontal.webp'
import senaleticaImage from '../assets/hero-senaletica-v2.webp'
import vinilesImage from '../assets/hero-viniles-v2.webp'
import { buildWhatsAppLink } from '../utils/whatsappLink.js'

export const siteConfig = {
  brandName: 'Joker',
  whatsappNumber: '51972044482',
  whatsappDisplay: '+51 972 044 482',
  phoneNumber: '+51972044482',
  phoneDisplay: '+51 972 044 482',
  email: 'jokerstudio.pe@gmail.com',
  locations: {
    lima: 'Lima, Perú.',
  },
  social: {
    instagram: { label: 'Instagram · @joker.publicidadcreativa', url: 'https://www.instagram.com/joker.publicidadcreativa/' },
    tiktok: { label: 'TikTok · @jokerstudio.pe', url: 'https://www.tiktok.com/@jokerstudio.pe' },
    facebook: { label: 'Facebook · Joker Studio Publicitario', url: 'https://www.facebook.com/Jokerstudiopublicitario' },
  },
}

export const whatsappMessages = {
  general: '¡Hola, Joker! 👋 Quisiera cotizar publicidad para mi negocio. ¿Me ayudan? ✨',
  letreros: '¡Hola, Joker! 👋 Me interesa un letrero para mi negocio. ¿Podemos cotizarlo? 💡',
  letras3d: '¡Hola, Joker! 👋 Quisiera cotizar letras 3D para mi marca. ✨',
  granFormato: '¡Hola, Joker! 👋 Necesito una impresión de gran formato. ¿Me ayudan a cotizar? 🖨️',
  viniles: '¡Hola, Joker! 👋 Me interesan sus viniles publicitarios. ¿Podemos cotizar? 🎨',
  senaletica: '¡Hola, Joker! 👋 Quisiera cotizar señalética para mi negocio. 📍',
  eventos: '¡Hola, Joker! 👋 Estoy preparando un evento y necesito publicidad. ¿Cotizamos? 🎉',
  empresarial: '¡Hola, Joker! 👋 Busco publicidad para mi empresa. ¿Me ayudan con una propuesta? ✨',
  especial: '¡Hola, Joker! 👋 Tengo una idea para mi negocio. ¿Me ayudan a hacerla realidad? 🎨',
}

const families = [
  {
    id: 'letreros',
    number: '02',
    title: 'Letreros y estructuras publicitarias',
    description: 'Cajas de luz, letreros con bastidor y vallas publicitarias. Gráfica, soporte e instalación según tu proyecto.',
    includes: ['Cajas de luz', 'Bastidores', 'Vallas publicitarias'],
    cta: 'Cotizar letrero',
    message: whatsappMessages.letreros,
    image: letrerosImage,
    detailPath: '/servicios/letreros',
    featured: true,
  },
  {
    id: 'letras-3d',
    number: '01',
    title: 'Letras corpóreas 3D',
    description: 'Todas las letras y logotipos con volumen, con o sin iluminación. Material y acabado según tu marca.',
    includes: ['PVC', 'Acrílico', 'MDF', 'Metal', 'Luz frontal', 'Retroiluminación'],
    cta: 'Cotizar letras 3D',
    message: whatsappMessages.letras3d,
    image: letras3dImage,
    detailPath: '/servicios/letras-3d',
    featured: true,
  },
  {
    id: 'neon-led',
    number: '03',
    title: 'Neón LED y espejos infinitos',
    description: 'Logos, frases y figuras luminosas, cuadros, alas para fotos y espejos con efecto infinito.',
    includes: ['Logotipos', 'Frases', 'Siluetas', 'Cuadros', 'Alas', 'Espejos infinitos'],
    cta: 'Cotizar neón LED',
    message: 'Hola, Joker. Quisiera cotizar neón LED o un espejo infinito.',
    image: neonImage,
    detailPath: '/servicios/neon-led',
    featured: true,
  },
  {
    id: 'gran-formato',
    number: '04',
    title: 'Gigantografías y banners',
    description: 'Impresión de gran formato para campañas, eventos, fachadas y espacios comerciales.',
    includes: ['Banners', 'Gigantografías', 'Campañas', 'Eventos', 'Fachadas', 'Gran formato'],
    cta: 'Cotizar impresión',
    message: whatsappMessages.granFormato,
    image: granFormatoImage,
    detailPath: '/servicios/gran-formato',
    featured: true,
  },
  {
    id: 'viniles',
    number: '05',
    title: 'Viniles publicitarios',
    description: 'Transformamos vitrinas, muros y superficies en espacios que comunican tu marca.',
    includes: ['Adhesivo', 'Microperforado', 'Transparente', 'Vitrinas', 'Muros', 'Rotulado'],
    cta: 'Cotizar vinil',
    message: whatsappMessages.viniles,
    image: vinilesImage,
    detailPath: '/servicios/viniles',
    featured: true,
  },
  {
    id: 'senaletica',
    number: '06',
    title: 'Señalética',
    description: 'Orientación clara y una presencia coherente para interiores y exteriores.',
    includes: ['Comercial', 'Corporativa', 'Informativa', 'Interior', 'Exterior'],
    cta: 'Cotizar señalética',
    message: whatsappMessages.senaletica,
    image: senaleticaImage,
    detailPath: '/servicios/senaletica',
  },
  {
    id: 'eventos',
    number: '07',
    title: 'Publicidad para eventos',
    description: 'Elementos listos para presentar tu marca con impacto en ferias y activaciones.',
    includes: ['Roll screen', 'Backing', 'Displays', 'Paneles', 'Elementos promocionales'],
    cta: 'Cotizar evento',
    message: whatsappMessages.eventos,
    image: eventosImage,
    detailPath: '/servicios/eventos',
  },
]

export const serviceFamilies = [...families].sort((a, b) => Number(a.number) - Number(b.number))

export function createWhatsAppLink({ service = 'general', message } = {}) {
  const finalMessage = message || whatsappMessages[service] || whatsappMessages.general
  return buildWhatsAppLink(siteConfig.whatsappNumber, finalMessage)
}





