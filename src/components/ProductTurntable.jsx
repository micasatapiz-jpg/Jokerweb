import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

function limitar(valor, minimo, maximo) {
  return Math.min(Math.max(valor, minimo), maximo)
}

function ProductTurntable({
  ruta,
  cantidad = 120,
  digitos = 3,
  nombre = 'Producto Joker',
  modo = 'mouse',
}) {
  const canvasRef = useRef(null)
  const imagenesRef = useRef([])
  const frameRef = useRef(0)
  const arrastreRef = useRef(null)
  const [cargados, setCargados] = useState(0)
  const [listo, setListo] = useState(false)

  const frames = useMemo(() => Array.from(
    { length: cantidad },
    (_, indice) => `${ruta}/frame-${String(indice + 1).padStart(digitos, '0')}.png`,
  ), [cantidad, digitos, ruta])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    let activo = true
    let observador
    const contexto = canvas.getContext('2d', { alpha: true })

    const dibujar = (indice = frameRef.current) => {
      const imagen = imagenesRef.current[indice]
      if (!imagen?.complete || !imagen.naturalWidth) return

      const ancho = canvas.width
      const alto = canvas.height
      const escala = Math.min(ancho / imagen.naturalWidth, alto / imagen.naturalHeight)
      const anchoImagen = imagen.naturalWidth * escala
      const altoImagen = imagen.naturalHeight * escala

      contexto.clearRect(0, 0, ancho, alto)
      contexto.imageSmoothingEnabled = true
      contexto.imageSmoothingQuality = 'high'
      contexto.drawImage(
        imagen,
        (ancho - anchoImagen) / 2,
        (alto - altoImagen) / 2,
        anchoImagen,
        altoImagen,
      )
    }

    const ajustar = () => {
      const limites = canvas.getBoundingClientRect()
      const densidad = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(Math.round(limites.width * densidad), 1)
      canvas.height = Math.max(Math.round(limites.height * densidad), 1)
      dibujar()
    }

    imagenesRef.current = frames.map((src, indice) => {
      const imagen = new Image()
      imagen.decoding = 'async'
      imagen.onload = () => {
        if (!activo) return
        setCargados((actual) => actual + 1)
        if (indice === 0) dibujar(0)
      }
      imagen.src = src
      return imagen
    })

    Promise.all(imagenesRef.current.map((imagen) => imagen.decode().catch(() => undefined)))
      .then(() => {
        if (!activo) return
        setListo(true)
        dibujar()
      })

    observador = new ResizeObserver(ajustar)
    observador.observe(canvas)
    ajustar()

    return () => {
      activo = false
      observador?.disconnect()
      imagenesRef.current.forEach((imagen) => { imagen.src = '' })
      imagenesRef.current = []
    }
  }, [frames])

  const mostrarFrame = useCallback((indice) => {
    const total = frames.length
    const normalizado = ((Math.round(indice) % total) + total) % total
    frameRef.current = normalizado

    const canvas = canvasRef.current
    const imagen = imagenesRef.current[normalizado]
    if (!canvas || !imagen?.complete || !imagen.naturalWidth) return

    const contexto = canvas.getContext('2d', { alpha: true })
    const escala = Math.min(canvas.width / imagen.naturalWidth, canvas.height / imagen.naturalHeight)
    const ancho = imagen.naturalWidth * escala
    const alto = imagen.naturalHeight * escala
    contexto.clearRect(0, 0, canvas.width, canvas.height)
    contexto.imageSmoothingEnabled = true
    contexto.imageSmoothingQuality = 'high'
    contexto.drawImage(imagen, (canvas.width - ancho) / 2, (canvas.height - alto) / 2, ancho, alto)
  }, [frames.length])

  useEffect(() => {
    if (modo !== 'scroll') return undefined

    const control = canvasRef.current?.closest('.signs-hero')
    if (!control) return undefined

    let animacion = 0
    const actualizarPorScroll = () => {
      animacion = 0
      const limites = control.getBoundingClientRect()
      const recorrido = Math.max(control.offsetHeight - window.innerHeight, 1)
      const progreso = limitar(-limites.top / recorrido, 0, 1)
      mostrarFrame(progreso * (frames.length - 1))
    }

    const solicitarActualizacion = () => {
      if (!animacion) animacion = window.requestAnimationFrame(actualizarPorScroll)
    }

    actualizarPorScroll()
    window.addEventListener('scroll', solicitarActualizacion, { passive: true })
    window.addEventListener('resize', solicitarActualizacion, { passive: true })

    return () => {
      if (animacion) window.cancelAnimationFrame(animacion)
      window.removeEventListener('scroll', solicitarActualizacion)
      window.removeEventListener('resize', solicitarActualizacion)
    }
  }, [frames.length, modo, mostrarFrame])

  const iniciarArrastre = (evento) => {
    evento.currentTarget.setPointerCapture(evento.pointerId)
    arrastreRef.current = {
      pointerId: evento.pointerId,
      x: evento.clientX,
      frame: frameRef.current,
    }
  }

  const mover = (evento) => {
    const arrastre = arrastreRef.current
    if (!arrastre || arrastre.pointerId !== evento.pointerId) return
    const ancho = evento.currentTarget.getBoundingClientRect().width || 1
    const diferencia = evento.clientX - arrastre.x
    mostrarFrame(arrastre.frame + (diferencia / ancho) * frames.length * 1.15)
  }

  const terminarArrastre = (evento) => {
    if (arrastreRef.current?.pointerId !== evento.pointerId) return
    arrastreRef.current = null
    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
      evento.currentTarget.releasePointerCapture(evento.pointerId)
    }
  }

  const alTeclado = (evento) => {
    if (evento.key === 'ArrowLeft') mostrarFrame(frameRef.current - 2)
    if (evento.key === 'ArrowRight') mostrarFrame(frameRef.current + 2)
  }

  const progreso = limitar(cargados / frames.length, 0, 1)

  return (
    <div
      className={`product-turntable product-turntable--${modo} ${listo ? 'product-turntable--ready' : ''}`}
      role="application"
      aria-label={`${nombre}. ${modo === 'scroll' ? 'Desplázate para encenderlo y girarlo en 360 grados.' : 'Arrastra horizontalmente para girarlo en 360 grados.'}`}
      tabIndex="0"
      onKeyDown={alTeclado}
      onPointerDown={modo === 'mouse' ? iniciarArrastre : undefined}
      onPointerMove={modo === 'mouse' ? mover : undefined}
      onPointerUp={modo === 'mouse' ? terminarArrastre : undefined}
      onPointerCancel={modo === 'mouse' ? terminarArrastre : undefined}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      {!listo && (
        <div className="product-turntable__loading" role="status">
          <span>Preparando vista 360°</span>
          <div aria-hidden="true"><i style={{ transform: `scaleX(${progreso})` }} /></div>
          <small>{Math.min(cargados, frames.length)} / {frames.length}</small>
        </div>
      )}
      <div className="product-turntable__hint" aria-hidden="true">
        {modo === 'scroll' ? (
          <><span>↓</span> Desliza para encender y girar</>
        ) : (
          <><span>←</span> Arrastra para girar <span>→</span></>
        )}
      </div>
    </div>
  )
}

export default ProductTurntable
