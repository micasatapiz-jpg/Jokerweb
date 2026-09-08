import { useEffect, useRef, useState } from 'react'

function HeroProductCarousel({ products, label = 'Productos destacados', fit = 'cover' }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [manualPaused, setManualPaused] = useState(false)
  const [focusPaused, setFocusPaused] = useState(false)
  const [pageVisible, setPageVisible] = useState(true)
  const pointerStart = useRef(null)

  const showPrevious = () => {
    setActiveIndex((current) => (current - 1 + products.length) % products.length)
  }

  const showNext = () => {
    setActiveIndex((current) => (current + 1) % products.length)
  }

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (manualPaused || focusPaused || !pageVisible || reducedMotion || products.length < 2) return undefined

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % products.length)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [focusPaused, manualPaused, pageVisible, products.length])

  useEffect(() => {
    const handleVisibility = () => setPageVisible(!document.hidden)
    handleVisibility()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  const slides = products.map((product) => ({
    ...product,
    nombre: product.nombre || product.name,
    imagen: product.imagen || product.image,
  }))
  const safeIndex = slides.length ? activeIndex % slides.length : 0
  const activeProduct = slides[safeIndex]

  if (!activeProduct) return null

  return (
    <section
      className={`hero-product-carousel hero-product-carousel--${fit}`}
      aria-label={label}
      aria-roledescription="carrusel"
      tabIndex="0"
      onFocus={() => setFocusPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusPaused(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') showPrevious()
        if (event.key === 'ArrowRight') showNext()
      }}
      onPointerDown={(event) => {
        pointerStart.current = event.clientX
      }}
      onPointerUp={(event) => {
        if (pointerStart.current === null) return
        const distance = event.clientX - pointerStart.current
        if (Math.abs(distance) > 45) {
          if (distance > 0) showPrevious()
          else showNext()
        }
        pointerStart.current = null
      }}
      onPointerCancel={() => {
        pointerStart.current = null
      }}
    >
      <div className="hero-product-carousel__slides">
        {slides.map((product, index) => (
          <figure
            className={`hero-product-carousel__slide${index === safeIndex ? ' is-active' : ''}`}
            key={product.nombre}
            aria-hidden={index !== activeIndex}
            style={{ '--slide-a': product.colorA, '--slide-b': product.colorB }}
          >
            <img src={product.imagen} alt={index === activeIndex ? product.nombre : ''} />
          </figure>
        ))}
      </div>

      <div className="hero-product-carousel__meta" aria-live={manualPaused || focusPaused ? 'polite' : 'off'}>
        <span>{String(safeIndex + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</span>
        <strong>{activeProduct.nombre}</strong>
      </div>

      <div className="hero-product-carousel__controls">
        <button
          type="button"
          onClick={() => setManualPaused((current) => !current)}
          aria-label={manualPaused ? 'Reanudar carrusel automático' : 'Pausar carrusel automático'}
          aria-pressed={manualPaused}
        >
          {manualPaused ? '▶' : 'Ⅱ'}
        </button>
        <button type="button" onClick={showPrevious} aria-label="Mostrar producto anterior">←</button>
        <button type="button" onClick={showNext} aria-label="Mostrar producto siguiente">→</button>
      </div>
    </section>
  )
}

export default HeroProductCarousel
