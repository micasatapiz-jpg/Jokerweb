import ServiceCard from '../components/ServiceCard'
import HeroProductCarousel from '../components/HeroProductCarousel'
import WhatsAppButton from '../components/WhatsAppButton'
import { serviceFamilies } from '../config/siteConfig'
import serviciosProduccion from '../assets/editorial/servicios-produccion-v1.webp'

const serviceHeroSlides = serviceFamilies.map(service => ({
  nombre: service.title,
  imagen: service.image,
  colorA: '#4ed8c4',
  colorB: '#1b1a4a',
}))

function Catalogo() {
  return (
    <section className="page services-page" aria-labelledby="services-title">
      <header className="services-hero services-hero--carousel editorial-hero">
        <div className="editorial-hero__visual">
          <HeroProductCarousel products={serviceHeroSlides} label="Familias de servicios de Joker" />
        </div>
        <div className="editorial-hero__copy">
          <p className="eyebrow">Publicidad e impresión en Lima</p>
          <h1 id="services-title">Impresión y producción para tu marca.</h1>
          <p>
            Imprimimos banners, gigantografías y viniles. Fabricamos letras corpóreas, letreros, señalética y exhibidores, además de piezas en neón LED.
            Elige una categoría o envíanos una foto del espacio: te ayudamos a definir
            materiales, medidas y acabado. La instalación se coordina según el proyecto y la ubicación.
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
        <p className="section-kicker">Soluciones a medida</p>
        <h2 id="also-services-title">Combina productos para un mismo proyecto.</h2>
        <p>
          Para una apertura puedes combinar letras corpóreas, vinil de vitrina y un banner promocional. Cuéntanos qué necesitas y preparamos una propuesta con cada pieza, sus medidas y su instalación.
        </p>
        <WhatsAppButton servicio="especial" origen="services-special" texto="Contarnos tu idea" />
      </aside>
    </section>
  )
}

export default Catalogo




