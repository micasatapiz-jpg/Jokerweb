import { useEffect, useMemo, useState } from 'react'
import ProductCard from '../components/ProductCard'
import { obtenerTodosLosProductos } from '../services/productosService'

const categorias = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'neon', etiqueta: 'Neón' },
  { valor: 'luminosos', etiqueta: 'Luminosos' },
  { valor: 'banners', etiqueta: 'Banners' },
  { valor: 'vinilos', etiqueta: 'Vinilos' },
  { valor: 'impresion', etiqueta: 'Impresión' },
  { valor: 'volantes', etiqueta: 'Volantes' },
  { valor: 'afiches', etiqueta: 'Afiches' },
  { valor: 'tarjetas', etiqueta: 'Tarjetas' },
  { valor: 'letreros3d', etiqueta: 'Letreros 3D' },
]

function Catalogo() {
  const [productos, setProductos] = useState([])
  const [categoriaActiva, setCategoriaActiva] = useState('todos')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let activo = true

    async function cargarProductos() {
      try {
        const datos = await obtenerTodosLosProductos()
        if (activo) setProductos(datos)
      } catch (errorDeCarga) {
        console.error(errorDeCarga)
        if (activo) setError('No se pudieron cargar los productos. Inténtalo nuevamente.')
      } finally {
        if (activo) setCargando(false)
      }
    }

    cargarProductos()
    return () => { activo = false }
  }, [])

  const productosFiltrados = useMemo(() => {
    if (categoriaActiva === 'todos') return productos
    return productos.filter((producto) => producto.categoria === categoriaActiva)
  }, [categoriaActiva, productos])

  return (
    <section className="page">
      <h1>Catálogo de productos</h1>
      <p>Explora las soluciones que podemos crear para tu negocio.</p>

      <div className="catalog-filters" aria-label="Filtrar productos por categoría">
        {categorias.map((categoria) => (
          <button
            key={categoria.valor}
            type="button"
            className={categoriaActiva === categoria.valor ? 'active' : ''}
            onClick={() => setCategoriaActiva(categoria.valor)}
            aria-pressed={categoriaActiva === categoria.valor}
          >
            {categoria.etiqueta}
          </button>
        ))}
      </div>

      {cargando && <p role="status">Cargando...</p>}
      {error && <p role="alert">{error}</p>}
      {!cargando && !error && productosFiltrados.length === 0 && (
        <p>No hay productos en esta categoría.</p>
      )}
      {!cargando && !error && productosFiltrados.length > 0 && (
        <div className="product-grid">
          {productosFiltrados.map((producto) => (
            <ProductCard key={producto.id} producto={producto} />
          ))}
        </div>
      )}
    </section>
  )
}

export default Catalogo
