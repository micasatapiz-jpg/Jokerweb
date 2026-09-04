import { Link, Navigate, useParams } from 'react-router-dom'
import WhatsAppButton from '../components/WhatsAppButton'
import { getProductFamily } from '../config/productFamilies'

function ProductosFamilia() {
  const { familia } = useParams()
  const family = getProductFamily(familia)

  if (!family) return <Navigate to="/catalogo" replace />

  return (
    <div className="family-page">
      <header className="family-hero" style={{ '--hero-image': `url(${family.hero})` }}>
        <Link to="/catalogo" className="family-back">← Volver a servicios</Link>
        <p className="eyebrow">{family.eyebrow}</p>
        <h1>{family.title}</h1>
        <div className="family-hero__footer">
          <p>{family.description}</p>
          <WhatsAppButton mensaje={family.message} origen={`familia-${family.slug}`} texto="Cotizar proyecto" />
        </div>
      </header>

      <section className="family-products" aria-label={`Productos de ${family.eyebrow}`}>
        {family.products.map((product, index) => (
          <article
            className="family-product"
            key={product.name}
            style={{ '--product-a': product.colorA, '--product-b': product.colorB }}
          >
            <figure className="family-product__visual">
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <img src={product.image} alt={product.name} loading={index < 2 ? 'eager' : 'lazy'} />
            </figure>
            <div className="family-product__copy">
              <div>
                <small>{family.eyebrow}</small>
                <h2>{product.name}</h2>
                <p>{product.description}</p>
              </div>
              <WhatsAppButton
                mensaje={`Hola Joker 👋 Quisiera cotizar ${product.name}.`}
                origen={`${family.slug}-${product.name}`}
                texto="Cotizar este producto"
              />
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}

export default ProductosFamilia
