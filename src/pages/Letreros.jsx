import { Link, Navigate, useLocation } from 'react-router-dom'
import EditorialProductGallery from '../components/EditorialProductGallery'
import HeroProductCarousel from '../components/HeroProductCarousel'
import WhatsAppButton from '../components/WhatsAppButton'
import ServiceGuide from '../components/ServiceGuide'
import { getProductFamily } from '../config/productFamilies'

function Letreros() {
  const { hash } = useLocation()
  if (hash === '#corporeas') return <Navigate to="/servicios/letras-3d" replace />
  if (hash === '#neon' || hash === '#infinitos') return <Navigate to="/servicios/neon-led" replace />
  const family = getProductFamily('letreros')
  return (
    <div className="signs-page">
      <header className="signs-hero signs-hero--editorial">
        <div className="signs-hero__copy">
          <Link to="/catalogo" className="signs-back">← Volver a servicios</Link>
          <p className="eyebrow">Gráfica y estructura para tu negocio</p>
          <h1>Letreros y estructuras publicitarias en Lima</h1>
          <p>{family.description}</p>
          <div className="signs-hero__actions">
            <WhatsAppButton servicio="letreros" origen="letreros-catalogo" texto="Cotizar un letrero" />
            <a href="#estructuras">Ver tipos de letreros ↓</a>
          </div>
        </div>
        <div className="signs-hero__visual">
          <HeroProductCarousel products={family.products} label="Cajas de luz, bastidores y vallas" fit="contain" />
        </div>
      </header>
      <section id="estructuras" style={{ scrollMarginTop: '7rem' }} aria-label="Letreros con estructura">
        <EditorialProductGallery family={family} />
      </section>
      <nav className="service-guide" aria-label="Otras familias de letreros">
        <h2>¿Buscas otra solución?</h2>
        <p><Link to="/servicios/letras-3d">Letras y logotipos con volumen →</Link></p>
        <p><Link to="/servicios/neon-led">Neón LED y espejos infinitos →</Link></p>
        <p><Link to="/servicios/gran-formato">Solo impresión de gigantografías y banners →</Link></p>
      </nav>
      <ServiceGuide slug="letreros" />
    </div>
  )
}
export default Letreros

