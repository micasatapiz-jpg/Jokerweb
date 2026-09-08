import { Link, Navigate, useParams } from 'react-router-dom'
import EditorialProductGallery from '../components/EditorialProductGallery'
import HeroProductCarousel from '../components/HeroProductCarousel'
import WhatsAppButton from '../components/WhatsAppButton'
import { getProductFamily } from '../config/productFamilies'

function ProductosFamilia() {
  const { familia } = useParams()
  const family = getProductFamily(familia)

  if (!family) return <Navigate to="/catalogo" replace />

  return (
    <div className="family-page">
      <header className="family-hero family-hero--carousel editorial-hero">
        <div className="editorial-hero__visual" aria-hidden="false">
          <HeroProductCarousel
            products={family.products}
            label={`Productos destacados de ${family.eyebrow}`}
            fit="contain"
          />
        </div>
        <div className="editorial-hero__copy">
          <Link to="/catalogo" className="family-back">← Volver a servicios</Link>
          <p className="eyebrow">{family.eyebrow}</p>
          <h1>{family.title}</h1>
          <div className="family-hero__footer">
            <p>{family.description}</p>
            <WhatsAppButton mensaje={family.message} origen={`familia-${family.slug}`} texto="Cotizar proyecto" />
          </div>
        </div>
      </header>

      <EditorialProductGallery family={family} />
    </div>
  )
}

export default ProductosFamilia
