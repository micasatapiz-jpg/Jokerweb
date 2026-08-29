import WhatsAppButton from './WhatsAppButton'

function ProductCard({ producto }) {
  const mensaje = `Hola, quiero cotizar: ${producto.nombre}`

  return (
    <article className="product-card">
      <img
        className="product-card__image"
        src={producto.imagenUrl}
        alt={producto.nombre}
        loading="lazy"
      />
      <div className="product-card__content">
        <h2>{producto.nombre}</h2>
        <p>{producto.descripcion}</p>
        <WhatsAppButton mensaje={mensaje} />
      </div>
    </article>
  )
}

export default ProductCard
