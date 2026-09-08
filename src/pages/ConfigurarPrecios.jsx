import { useEffect, useMemo, useState } from 'react'
import SalesSidebar from '../components/SalesSidebar'
import { salesApi } from '../services/salesApi'

const emptyRule = {
  name: 'Tarifa comercial',
  basePrice: 0,
  pricePerSquareMeter: 0,
  designFee: 0,
  installationFee: 0,
  transportFee: 0,
  marginPercent: 20,
  igvPercent: 18,
}

const money = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })

function ruleToForm(rule) {
  if (!rule) return emptyRule
  return Object.fromEntries(
    Object.entries(emptyRule).map(([key, fallback]) => [key, key === 'name' ? rule[key] || fallback : Number(rule[key] ?? fallback)]),
  )
}

function ConfigurarPrecios() {
  const [products, setProducts] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState(emptyRule)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const selected = useMemo(() => products.find((product) => product.id === selectedId), [products, selectedId])
  const activeRule = selected?.priceRules?.[0]

  const loadProducts = async (preferredId) => {
    const data = await salesApi.products()
    setProducts(data)
    const nextId = preferredId || selectedId || data[0]?.id || ''
    setSelectedId(nextId)
    const nextProduct = data.find((product) => product.id === nextId)
    setForm(ruleToForm(nextProduct?.priceRules?.[0]))
  }

  useEffect(() => {
    let active = true
    salesApi.products()
      .then((data) => {
        if (!active) return
        setProducts(data)
        const firstId = data[0]?.id || ''
        setSelectedId(firstId)
        setForm(ruleToForm(data[0]?.priceRules?.[0]))
      })
      .catch((error) => {
        if (active) setNotice({ type: 'error', text: error.message })
      })
    return () => { active = false }
  }, [])

  const selectProduct = (event) => {
    const id = event.target.value
    const product = products.find((candidate) => candidate.id === id)
    setSelectedId(id)
    setForm(ruleToForm(product?.priceRules?.[0]))
    setNotice(null)
  }

  const update = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setNotice(null)
  }

  const sampleTotal = useMemo(() => {
    const net = Number(form.basePrice || 0) + Number(form.pricePerSquareMeter || 0)
    const withMargin = net * (1 + Number(form.marginPercent || 0) / 100)
    return withMargin * (1 + Number(form.igvPercent || 0) / 100)
  }, [form])

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, key === 'name' ? value : Number(value)]),
      )
      await salesApi.updatePriceRule(selectedId, payload)
      await loadProducts(selectedId)
      setNotice({ type: 'success', text: 'La nueva tarifa quedó activa. Las cotizaciones anteriores conservan sus importes.' })
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sales-shell">
      <SalesSidebar />
      <section className="sales-workspace price-config">
        <header className="sales-workspace__header">
          <div><p>Configuración comercial</p><h1>Productos y precios</h1></div>
        </header>

        {notice && <div className={`sales-notice sales-notice--${notice.type}`} role="status">{notice.text}</div>}

        <div className="price-config__layout">
          <aside className="product-picker" aria-label="Productos disponibles">
            <label htmlFor="product-select">Producto que vas a editar</label>
            <select id="product-select" value={selectedId} onChange={selectProduct}>
              {products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}
            </select>
            <div className="product-picker__list">
              {products.map((product) => (
                <button type="button" key={product.id} className={product.id === selectedId ? 'is-active' : ''} onClick={() => selectProduct({ target: { value: product.id } })}>
                  <span>{product.name}</span><small>{product.category}</small>
                  {product.priceRules[0]?.isDemo && <b>Precio de prueba</b>}
                </button>
              ))}
            </div>
          </aside>

          {selected && (
            <form className="sales-card price-form" onSubmit={save}>
              <div className="sales-card__heading">
                <div><span>{selected.category}</span><h2>{selected.name}</h2></div>
                <small>{activeRule?.isDemo ? 'Tarifa de prueba activa' : 'Tarifa comercial activa'}</small>
              </div>

              <label>Nombre de esta tarifa<input name="name" value={form.name} onChange={update} required /></label>

              <section className="price-form__section" aria-labelledby="price-main-title">
                <div><h3 id="price-main-title">Precio principal</h3><p>Importes antes del margen y del IGV.</p></div>
                <div className="sales-grid sales-grid--2">
                  <label>Precio base (S/)<input name="basePrice" type="number" min="0" max="1000000" step="0.01" value={form.basePrice} onChange={update} required /></label>
                  <label>Precio por m² (S/)<input name="pricePerSquareMeter" type="number" min="0" max="1000000" step="0.01" value={form.pricePerSquareMeter} onChange={update} required /></label>
                </div>
              </section>

              <section className="price-form__section" aria-labelledby="price-services-title">
                <div><h3 id="price-services-title">Servicios adicionales</h3><p>Se suman únicamente cuando los marcas en una cotización.</p></div>
                <div className="sales-grid sales-grid--3">
                  <label>Diseño (S/)<input name="designFee" type="number" min="0" step="0.01" value={form.designFee} onChange={update} required /></label>
                  <label>Instalación (S/)<input name="installationFee" type="number" min="0" step="0.01" value={form.installationFee} onChange={update} required /></label>
                  <label>Transporte (S/)<input name="transportFee" type="number" min="0" step="0.01" value={form.transportFee} onChange={update} required /></label>
                </div>
              </section>

              <section className="price-form__section" aria-labelledby="price-percent-title">
                <div><h3 id="price-percent-title">Margen e impuesto</h3><p>El margen se aplica primero; después se calcula el IGV.</p></div>
                <div className="sales-grid sales-grid--2">
                  <label>Margen (%)<input name="marginPercent" type="number" min="0" max="500" step="0.01" value={form.marginPercent} onChange={update} required /></label>
                  <label>IGV (%)<input name="igvPercent" type="number" min="0" max="100" step="0.01" value={form.igvPercent} onChange={update} required /></label>
                </div>
              </section>

              <div className="price-preview"><div><span>Referencia de 1 m²</span><small>Sin diseño, instalación ni transporte</small></div><strong>{money.format(sampleTotal)}</strong></div>
              <div className="sales-actions"><p className="price-form__history">La tarifa actual quedará guardada en el historial.</p><button className="sales-button" disabled={busy || !selectedId}>{busy ? 'Guardando…' : 'Guardar nueva tarifa'}</button></div>
            </form>
          )}
        </div>
      </section>
    </div>
  )
}

export default ConfigurarPrecios
