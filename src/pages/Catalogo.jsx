import ServiceCard from '../components/ServiceCard'
import WhatsAppButton from '../components/WhatsAppButton'
import { serviceFamilies } from '../config/siteConfig'
import serviciosHero from '../assets/heroes/servicios.png'

function Catalogo() {
  return (
    <section className="page services-page" aria-labelledby="services-title">
      <header className="services-hero" style={{ '--hero-image': `url(${serviciosHero})` }}>
        <p className="eyebrow">Servicios y productos</p>
        <h1 id="services-title">Soluciones publicitarias para hacer visible tu marca.</h1>
        <p>
          Diseñamos, producimos, fabricamos e instalamos. Elige el servicio que más se
          parece a tu proyecto y escríbenos por WhatsApp para cotizarlo.
        </p>
      </header>

      <div className="services-grid services-grid--catalog">
        {serviceFamilies.map((service) => (
          <ServiceCard key={service.id} service={service} />
        ))}
      </div>

      <aside className="also-services" aria-labelledby="also-services-title">
        <p className="section-kicker">También hacemos</p>
        <h2 id="also-services-title">Proyectos que no caben en una sola categoría.</h2>
        <p>
          Stickers personalizados · rotulado vehicular · neón LED · tótems publicitarios ·
          proyectos especiales.
        </p>
        <WhatsAppButton servicio="especial" origen="services-special" texto="Contarnos tu idea" />
      </aside>
    </section>
  )
}

export default Catalogo
