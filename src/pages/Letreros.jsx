import { Link } from 'react-router-dom'
import EditorialProductGallery from '../components/EditorialProductGallery'
import HeroProductCarousel from '../components/HeroProductCarousel'
import WhatsAppButton from '../components/WhatsAppButton'
import ServiceGuide from '../components/ServiceGuide'
import { catalogSignGroups, catalogSigns } from '../config/catalogoLetreros'

function Letreros() {
  return (
    <div className="signs-page">
      <header className="signs-hero signs-hero--editorial">
        <div className="signs-hero__copy">
          <Link to="/catalogo" className="signs-back">← Volver a servicios</Link>
          <p className="eyebrow">Letras, neón y luz para tu marca</p>
          <h1>Letreros luminosos y publicitarios en Lima</h1>
          <p>Letras corpóreas iluminadas, neón LED personalizado y espejos infinitos. Explora los materiales y efectos de luz para encontrar el letrero de tu negocio.</p>
          <div className="signs-hero__actions">
            <WhatsAppButton servicio="letreros" origen="letreros-catalogo" texto="Cotizar un letrero" />
            <a href="#corporeas">Ver tipos de letreros <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="signs-hero__visual">
          <HeroProductCarousel products={catalogSigns} label="Tipos de letreros de Joker" fit="contain" />
        </div>
      </header>

      <nav aria-label="Tipos de letreros" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', padding: '2rem clamp(1.25rem, 5vw, 5rem)' }}>
        {catalogSignGroups.map((group) => (
          <a key={group.id} href={`#${group.id}`} className="family-back">{group.title} ↓</a>
        ))}
      </nav>

      {catalogSignGroups.map((group) => (
        <section key={group.id} id={group.id} aria-labelledby={`heading-${group.id}`} style={{ scrollMarginTop: '7rem' }}>
          <header style={{ padding: '2rem clamp(1.25rem, 5vw, 5rem) 0', maxWidth: '65rem' }}>
            <p className="eyebrow">Tipos de letreros</p>
            <h2 id={`heading-${group.id}`} style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', lineHeight: 1.12 }}>{group.title}</h2>
            <p>{group.description}</p>
          </header>
          <EditorialProductGallery family={{ slug: `letreros-${group.id}`, eyebrow: group.title, products: group.products }} />
        </section>
      ))}
      <ServiceGuide slug="letreros" />
    </div>
  )
}

export default Letreros
