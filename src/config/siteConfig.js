import eventosImage from '../assets/heroes/eventos-photo-v1.webp'
import granFormatoImage from '../assets/heroes/gran-formato-photo-v1.webp'
import letrerosImage from '../assets/heroes/letreros-photo-v1.webp'
import letras3dImage from '../assets/heroes/letras-3d-photo-v1.webp'
import senaleticaImage from '../assets/heroes/senaletica-photo-v1.webp'
import vinilesImage from '../assets/heroes/viniles-photo-v1.webp'

export const siteConfig = {
  brandName: 'Joker',
  whatsappNumber: '51972044482',
  whatsappDisplay: '+51 972 044 482',
  phoneNumber: '+51972044482',
  phoneDisplay: '+51 972 044 482',
  email: 'jokerstudio.pe@gmail.com',
  locations: {
    lima: 'Operaciones y atención comercial digital.',
    huancayo: 'Espacio Joker dentro de Casa Tapiz — dirección por confirmar.',
  },
  social: {
    instagram: { label: 'Instagram — próximamente', url: '' },
    tiktok: { label: 'Joker 3D Perú', url: '' },
    facebook: { label: 'Joker', url: '' },
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

export const serviceFamilies = [
  {
    id: 'letreros',
    number: '01',
    title: 'Letreros luminosos y publicitarios',
    description: 'Fabricamos letreros que hacen visible tu negocio de día y de noche.',
    includes: ['LED', 'Cajas de luz', 'Acrílico', 'Retroiluminados', 'Bastidores', 'Fachadas'],
    cta: 'Cotizar letrero',
    message: whatsappMessages.letreros,
    image: letrerosImage,
    detailPath: '/servicios/letreros',
    featured: true,
  },
  {
    id: 'letras-3d',
    number: '02',
    title: 'Letras corpóreas 3D',
    description: 'Volumen, materiales y luz para que el nombre de tu marca tenga presencia.',
    includes: ['Acrílico', 'PVC', 'MDF', 'Metal', 'Iluminadas', 'Retroiluminadas'],
    cta: 'Cotizar letras 3D',
    message: whatsappMessages.letras3d,
    image: letras3dImage,
    detailPath: '/servicios/letras-3d',
    featured: true,
  },
  {
    id: 'gran-formato',
    number: '03',
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
    number: '04',
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
    number: '05',
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
    number: '06',
    title: 'Publicidad para eventos',
    description: 'Elementos listos para presentar tu marca con impacto en ferias y activaciones.',
    includes: ['Roll screen', 'Backing', 'Displays', 'Paneles', 'Elementos promocionales'],
    cta: 'Cotizar evento',
    message: whatsappMessages.eventos,
    image: eventosImage,
    detailPath: '/servicios/eventos',
  },
]

export function createWhatsAppLink({ service = 'general', message } = {}) {
  const finalMessage = message || whatsappMessages[service] || whatsappMessages.general
  return `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(finalMessage)}`
}
