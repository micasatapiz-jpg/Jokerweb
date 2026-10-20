import { Link } from 'react-router-dom'
import EditorialProductGallery from '../components/EditorialProductGallery'
import HeroProductCarousel from '../components/HeroProductCarousel'
import WhatsAppButton from '../components/WhatsAppButton'
import ServiceGuide from '../components/ServiceGuide'
import bastidorPublicitario from '../assets/productos/letreros/bastidor-publicitario-photo-v1.webp'
import cajaLuz from '../assets/productos/letreros/caja-luz-photo-v1.webp'
import fachadaComercial from '../assets/productos/letreros/fachada-comercial-photo-v1.webp'
import letreroAcrilico from '../assets/productos/letreros/letrero-acrilico-photo-v1.webp'
import letrasCorporeas from '../assets/productos/letreros/letras-corporeas-led-photo-v1.webp'
import retroiluminado from '../assets/productos/letreros/retroiluminado-photo-v1.webp'

const productos = [
  {
    nombre: 'Letras corpóreas LED',
    descripcion: 'Letras con relieve y luz frontal. Define tamaño y contraste según la distancia de lectura.',
    imagen: letrasCorporeas,
    detalle: 'Volumen · Acrílico · Iluminación LED',
    colorA: '#5a2d92',
    colorB: '#22d3c5',
  },
  {
    nombre: 'Cajas de luz',
    descripcion: 'Gabinetes iluminados que muestran tu logo y mensaje en una sola pieza. Medidas y fijación según el espacio.',
    imagen: cajaLuz,
    detalle: 'Iluminación uniforme · Interior o exterior',
    colorA: '#f2b705',
    colorB: '#d55a2a',
  },
  {
    nombre: 'Letreros en acrílico',
    descripcion: 'Placas y letras para recepciones, identificaciones y fachadas. Espesor y acabado según el uso.',
    imagen: letreroAcrilico,
    detalle: 'Material y acabado según proyecto',
    colorA: '#3c8fba',
    colorB: '#6fe0d0',
  },
  {
    nombre: 'Retroiluminados',
    descripcion: 'Letras con luz posterior que forma un halo sobre el muro. El color y textura de la pared influyen en el efecto.',
    imagen: retroiluminado,
    detalle: 'Halo posterior · Luz cálida o fría',
    colorA: '#d68a34',
    colorB: '#623ca4',
  },
  {
    nombre: 'Bastidores publicitarios',
    descripcion: 'Estructuras para sostener y tensar gráficas. Comparte medidas y ubicación para definir soporte y montaje.',
    imagen: bastidorPublicitario,
    detalle: 'Soporte y fijación según proyecto',
    colorA: '#e85f52',
    colorB: '#304d94',
  },
  {
    nombre: 'Fachadas comerciales',
    descripcion: 'Integra el nombre de tu negocio, revestimiento e iluminación. Envía fotos de tu fachada para revisar qué elementos necesita.',
    imagen: fachadaComercial,
    detalle: 'Diseño integral · Fabricación e instalación',
    colorA: '#4ed8c4',
    colorB: '#1b1a4a',
  },
]

function Letreros() {
  const family = {
    slug: 'letreros',
    eyebrow: 'Letreros luminosos',
    products: productos.map((producto) => ({
      name: producto.nombre,
      description: `${producto.descripcion} ${producto.detalle}.`,
      image: producto.imagen,
      colorA: producto.colorA,
      colorB: producto.colorB,
    })),
  }

  return (
    <div className="signs-page">
      <header className="signs-hero signs-hero--editorial">
        <div className="signs-hero__copy">
          <Link to="/catalogo" className="signs-back">← Volver a servicios</Link>
          <p className="eyebrow">Dale presencia a tu fachada</p>
          <h1>Letreros luminosos y publicitarios en Lima</h1>
          <p>Diseñamos, fabricamos e instalamos letreros con volumen e iluminación para negocios en Lima.</p>
          <div className="signs-hero__actions">
            <WhatsAppButton
              servicio="letreros"
              origen="letreros-catalogo"
              texto="Cotizar un letrero"
            />
            <a href="#productos-letreros">Ver productos <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="signs-hero__visual">
          <HeroProductCarousel products={productos} label="Productos de letreros destacados" />
        </div>
      </header>

      <div id="productos-letreros">
        <EditorialProductGallery family={family} />
      </div>
      <ServiceGuide slug="letreros" />
    </div>
  )
}

export default Letreros


