import { Link } from 'react-router-dom'
import EditorialProductGallery from '../components/EditorialProductGallery'
import HeroProductCarousel from '../components/HeroProductCarousel'
import WhatsAppButton from '../components/WhatsAppButton'
import bastidorPublicitario from '../assets/productos/letreros/bastidor-publicitario-photo-v1.webp'
import cajaLuz from '../assets/productos/letreros/caja-luz-photo-v1.webp'
import fachadaComercial from '../assets/productos/letreros/fachada-comercial-photo-v1.webp'
import letreroAcrilico from '../assets/productos/letreros/letrero-acrilico-photo-v1.webp'
import letrasCorporeas from '../assets/productos/letreros/letras-corporeas-led-photo-v1.webp'
import retroiluminado from '../assets/productos/letreros/retroiluminado-photo-v1.webp'

const productos = [
  {
    nombre: 'Letras corpóreas LED',
    descripcion: 'Frente acrílico translúcido, cuerpo con volumen e iluminación LED uniforme.',
    imagen: letrasCorporeas,
    detalle: 'Volumen · Acrílico · Iluminación LED',
    colorA: '#5a2d92',
    colorB: '#22d3c5',
  },
  {
    nombre: 'Cajas de luz',
    descripcion: 'Gabinetes luminosos para fachadas, interiores y puntos de venta.',
    imagen: cajaLuz,
    detalle: 'Iluminación uniforme · Interior o exterior',
    colorA: '#f2b705',
    colorB: '#d55a2a',
  },
  {
    nombre: 'Letreros en acrílico',
    descripcion: 'Placas y letras cortadas con acabado limpio, moderno y durable.',
    imagen: letreroAcrilico,
    detalle: 'Corte de precisión · Acabado premium',
    colorA: '#3c8fba',
    colorB: '#6fe0d0',
  },
  {
    nombre: 'Retroiluminados',
    descripcion: 'Letras separadas del muro para crear un halo de luz elegante.',
    imagen: retroiluminado,
    detalle: 'Halo posterior · Luz cálida o fría',
    colorA: '#d68a34',
    colorB: '#623ca4',
  },
  {
    nombre: 'Bastidores publicitarios',
    descripcion: 'Estructuras resistentes para montar gráficas y señalización de gran formato.',
    imagen: bastidorPublicitario,
    detalle: 'Estructura modular · Gráfica reemplazable',
    colorA: '#e85f52',
    colorB: '#304d94',
  },
  {
    nombre: 'Fachadas comerciales',
    descripcion: 'Composición integral de revestimiento, identidad, volumen e iluminación.',
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
          <p className="eyebrow">Letreros luminosos y publicitarios</p>
          <h1>Tu marca, visible desde todos los ángulos.</h1>
          <p>Letreros con volumen e iluminación para destacar de día y de noche.</p>
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
    </div>
  )
}

export default Letreros
