import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import WhatsAppButton from './WhatsAppButton'

function EditorialProductGallery({ family }) {
  const [activeProduct, setActiveProduct] = useState(null)

  useEffect(() => {
    if (!activeProduct) return undefined

    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setActiveProduct(null)
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [activeProduct])

  return (
    <section className="editorial-catalog" aria-label={`Productos de ${family.eyebrow}`}>
      <div className="editorial-catalog__grid">
        {family.products.map((product, index) => (
          <button
            className="editorial-product"
            key={product.name}
            type="button"
            onClick={() => setActiveProduct(product)}
            style={{ '--product-a': product.colorA, '--product-b': product.colorB }}
            aria-label={`Ver detalles de ${product.name}`}
          >
            <span className="editorial-product__number" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <img src={product.image} alt="" loading={index < 2 ? 'eager' : 'lazy'} />
            <span className="editorial-product__veil" aria-hidden="true" />
            <span className="editorial-product__copy">
              <small>{family.eyebrow}</small>
              <strong>{product.name}</strong>
              <span>Ver producto <b aria-hidden="true">↗</b></span>
            </span>
          </button>
        ))}
      </div>

      {activeProduct && createPortal(
        <div
          className="product-quickview"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-quickview-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setActiveProduct(null)
          }}
        >
          <div className="product-quickview__panel">
            <button
              className="product-quickview__close"
              type="button"
              onClick={() => setActiveProduct(null)}
              aria-label="Cerrar detalle"
              autoFocus
            >
              ×
            </button>
            <figure
              className="product-quickview__visual"
              style={{ '--product-a': activeProduct.colorA, '--product-b': activeProduct.colorB }}
            >
              <img src={activeProduct.image} alt={activeProduct.name} />
            </figure>
            <div className="product-quickview__copy">
              <p className="eyebrow">{family.eyebrow}</p>
              <h2 id="product-quickview-title">{activeProduct.name}</h2>
              <p>{activeProduct.description}</p>
              <WhatsAppButton
                mensaje={`Hola Joker 👋 Quisiera cotizar ${activeProduct.name}.`}
                origen={`${family.slug}-${activeProduct.name}`}
                texto="Cotizar este producto"
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}

export default EditorialProductGallery
