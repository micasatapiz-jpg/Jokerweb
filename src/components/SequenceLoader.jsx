import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import '../styles/sequence-intro.css'

const DURACION_SALIDA = .2

export default function SequenceLoader({ ready, onComplete, progress, error, onRetry }) {
  const root = useRef(null)

  useLayoutEffect(() => {
    if (error) return undefined
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

      gsap.to(root.current, {
        opacity: 0,
        duration: reduced ? 0 : DURACION_SALIDA,
        ease: 'power2.inOut',
        onComplete,
      })
    }, root)
    return () => context.revert()
  }, [ready, onComplete, error])

  return (
    <div ref={root} className="image-sequence__loading" role="status" aria-label="Preparando la experiencia de Joker">
      {!error && <div className="image-sequence__loading-mark joker-intro" aria-hidden="true">
        <strong>JOKER</strong>
        <div className="sk-chase">
          {Array.from({ length: 6 }, (_, index) => <span className="sk-chase-dot" key={index} />)}
        </div>
        <progress className="joker-intro__progress" value={progress ?? 0} max="1" />
      </div>}
      {error ? (
        <div className="image-sequence__loading-message" role="alert">
          <p>No pudimos cargar el contenido.</p>
          <button type="button" onClick={onRetry}>Reintentar</button>
        </div>
      ) : progress !== undefined && (
        <span className="image-sequence__loading-message">
          Preparando tu primera visita · {Math.round(progress * 100)}%
        </span>
      )}
    </div>
  )
}
