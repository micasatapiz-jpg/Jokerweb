import ServiceCard from '../components/ServiceCard'
import HeroProductCarousel from '../components/HeroProductCarousel'
import WhatsAppButton from '../components/WhatsAppButton'
import { serviceFamilies } from '../config/siteConfig'
import { productFamilies } from '../config/productFamilies'
import serviciosHero from '../assets/heroes/letreros-photo-v1.webp'
import serviciosProduccion from '../assets/editorial/servicios-produccion-v1.png'

const serviceHeroSlides = [
  {
    nombre: 'Letreros luminosos',
    imagen: serviciosHero,
    colorA: '#4ed8c4',
    colorB: '#1b1a4a',
  },
  ...Object.entries(productFamilies).map(([slug, family]) => ({
    nombre: family.eyebrow,
    imagen: family.hero,
    colorA: family.products[0]?.[3] || '#4ed8c4',
    colorB: family.products[0]?.[4] || '#1b1a4a',
    slug,
  })),
]

function Catalogo() {
  return (
    <section className="page services-page" aria-labelledby="services-title">
      <header className="services-hero services-hero--carousel editorial-hero">
        <div className="editorial-hero__visual">
          <HeroProductCarousel products={serviceHeroSlides} label="Familias de servicios de Joker" />
        </div>
        <div className="editorial-hero__copy">
          <p className="eyebrow">Servicios y productos</p>
          <h1 id="services-title">Soluciones publicitarias para hacer visible tu marca.</h1>
          <p>
            Diseñamos, producimos, fabricamos e instalamos. Elige el servicio que más se
            parece a tu proyecto y escríbenos por WhatsApp para cotizarlo.
          </p>
        </div>
      </header>

      <div className="services-grid services-grid--catalog">
        {serviceFamilies.map((service) => (
          <ServiceCard key={service.id} service={service} />
        ))}
      </div>

      <aside
        className="also-services also-services--visual"
        aria-labelledby="also-services-title"
        style={{ '--section-image': `url(${serviciosProduccion})` }}
      >
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
