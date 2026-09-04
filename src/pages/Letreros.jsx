import { Link } from 'react-router-dom'
import ProductTurntable from '../components/ProductTurntable'
import WhatsAppButton from '../components/WhatsAppButton'
import bastidorPublicitario from '../assets/productos/letreros/bastidor-publicitario-v2.png'
import cajaLuz from '../assets/productos/letreros/caja-luz-v2.png'
import fachadaComercial from '../assets/productos/letreros/fachada-comercial-v2.png'
import letreroAcrilico from '../assets/productos/letreros/letrero-acrilico-v2.png'
import retroiluminado from '../assets/productos/letreros/retroiluminado-v2.png'
import letrerosHero from '../assets/heroes/letreros.png'

const productos = [
  {
    nombre: 'Letras corpóreas LED',
    descripcion: 'Frente acrílico translúcido, cuerpo con volumen e iluminación LED uniforme.',
    estado: 'Vista interactiva disponible',
    activo: true,
  },
  {
    nombre: 'Cajas de luz',
    descripcion: 'Gabinetes luminosos para fachadas, interiores y puntos de venta.',
    imagen: cajaLuz,
    detalle: 'Iluminación uniforme · Interior o exterior',
  },
  {
    nombre: 'Letreros en acrílico',
    descripcion: 'Placas y letras cortadas con acabado limpio, moderno y durable.',
    imagen: letreroAcrilico,
    detalle: 'Corte de precisión · Acabado premium',
  },
  {
    nombre: 'Retroiluminados',
    descripcion: 'Letras separadas del muro para crear un halo de luz elegante.',
    imagen: retroiluminado,
    detalle: 'Halo posterior · Luz cálida o fría',
  },
  {
    nombre: 'Bastidores publicitarios',
    descripcion: 'Estructuras resistentes para montar gráficas y señalización de gran formato.',
    imagen: bastidorPublicitario,
    detalle: 'Estructura modular · Gráfica reemplazable',
  },
  {
    nombre: 'Fachadas comerciales',
    descripcion: 'Composición integral de revestimiento, identidad, volumen e iluminación.',
    imagen: fachadaComercial,
    detalle: 'Diseño integral · Fabricación e instalación',
  },
]

function Letreros() {
  return (
    <div className="signs-page">
      <header className="signs-hero">
        <div className="signs-hero__sticky">
          <div className="signs-hero__copy" style={{ '--hero-image': `url(${letrerosHero})` }}>
            <Link to="/catalogo" className="signs-back">← Volver a servicios</Link>
            <p className="eyebrow">Letreros luminosos y publicitarios</p>
            <h1>Tu marca, visible desde todos los ángulos.</h1>
            <p>
              Diseñamos y fabricamos letreros con estructura, volumen e iluminación pensados
              para que tu negocio destaque de día y de noche.
            </p>
            <WhatsAppButton
              servicio="letreros"
              origen="letreros-360"
              texto="Cotizar un letrero"
            />
          </div>

          <div className="signs-hero__viewer">
            <ProductTurntable
              ruta="/sequences/letrero-joker-led"
              cantidad={180}
              nombre="Letrero corpóreo LED Joker"
              modo="scroll"
            />
            <div className="signs-specs" aria-label="Características del producto">
              <span>360°</span>
              <span>Acrílico</span>
              <span>LED animado</span>
              <span>Metal</span>
            </div>
          </div>
        </div>
      </header>

      <section className="signs-products" aria-labelledby="signs-products-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Familia de productos</p>
            <h2 id="signs-products-title">Una solución para cada fachada.</h2>
          </div>
          <p>La primera vista 360° ya está disponible. Las siguientes se incorporarán progresivamente.</p>
        </div>

        <div className="signs-products__grid">
          {productos.map((producto, indice) => (
            <article
              key={producto.nombre}
              className={producto.activo ? 'sign-product sign-product--active' : 'sign-product'}
            >
              {producto.imagen && (
                <figure className="sign-product__visual">
                  <img src={producto.imagen} alt={producto.nombre} loading="lazy" />
                </figure>
              )}
              <div className="sign-product__content">
                <span>{String(indice + 1).padStart(2, '0')}</span>
                <h3>{producto.nombre}</h3>
                <p>{producto.descripcion}</p>
                <small>{producto.estado ?? producto.detalle}</small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

export default Letreros
