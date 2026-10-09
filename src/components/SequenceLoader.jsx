import { useLayoutEffect, useRef } from 'react'
import { Zoomies } from 'ldrs/react'
import 'ldrs/react/Zoomies.css'
import { gsap } from 'gsap'

const DURACION_TOTAL_MS = 3000
const DURACION_SALIDA = .3

export default function SequenceLoader({ ready, onComplete, progress, error, onRetry, minDurationMs = DURACION_TOTAL_MS }) {
  const root = useRef(null)
  const inicioRef = useRef(0)

  useLayoutEffect(() => {
    if (!inicioRef.current) inicioRef.current = performance.now()
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const context = gsap.context(() => {
      if (!ready) {
        gsap.fromTo(
          root.current.firstElementChild,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: reduced ? 0 : .45, ease: 'power2.out' },
        )
        return
      }

      const transcurrido = performance.now() - inicioRef.current
      const espera = Math.max(
        minDurationMs - transcurrido - DURACION_SALIDA * 1000,
        0,
      ) / 1000
      gsap.to(root.current, {
        opacity: 0,
        duration: reduced ? 0 : DURACION_SALIDA,
        delay: espera,
        ease: 'power2.inOut',
        onComplete,
      })
    }, root)
    return () => context.revert()
  }, [ready, onComplete, minDurationMs])

  return (
    <div ref={root} className="image-sequence__loading" role="status" aria-label="Preparando la experiencia de Joker">
      <div className="image-sequence__loading-mark" aria-hidden="true">
        <strong>JOKER</strong>
        <Zoomies
          size={320}
          stroke={5}
          speed={1.25}
          bgOpacity={.16}
          color="var(--joker-turquoise)"
        />
      </div>
      {error ? (
        <div className="image-sequence__loading-message" role="alert">
          <p>No pudimos cargar la animación.</p>
          <button type="button" onClick={onRetry}>Reintentar</button>
        </div>
      ) : progress !== undefined && (
        <span className="image-sequence__loading-message">
          Preparando animación {Math.round(progress * 100)}%
        </span>
      )}
    </div>
  )
}
