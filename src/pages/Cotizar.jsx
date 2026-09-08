import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { createWhatsAppLink } from '../config/siteConfig'
import { salesApi } from '../services/salesApi'

const acceptedImages = ['image/png', 'image/jpeg', 'image/webp']
const initialItem = {
  productId: '', quantity: 1, widthM: '', heightM: '',
  installationRequired: false, includeDesign: false, includeTransport: false, discountPercent: 0,
}
const money = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })

function normalizeItem(item) {
  return {
    ...item,
    quantity: Number(item.quantity),
    widthM: item.widthM === '' ? undefined : Number(item.widthM),
    heightM: item.heightM === '' ? undefined : Number(item.heightM),
    discountPercent: 0,
  }
}

function validateImage(file) {
  if (!acceptedImages.includes(file.type)) return `${file.name}: usa PNG, JPG o WebP.`
  if (file.size > 10 * 1024 * 1024) return `${file.name}: la imagen debe pesar menos de 10 MB.`
  return ''
}

function FileField({ id, label, hint, file, files, multiple = false, onChange }) {
  const selected = multiple ? files : file ? [file] : []
  return (
    <div className="quote-file-field">
      <div><strong>{label}</strong><span>{hint}</span></div>
      {selected.length > 0 && <ul>{selected.map((item) => <li key={`${item.name}-${item.size}`}>{item.name}</li>)}</ul>}
      <label className="sales-button sales-button--secondary" htmlFor={id}>{selected.length ? 'Cambiar imágenes' : 'Seleccionar imagen'}</label>
      <input id={id} className="quote-file-field__input" type="file" accept="image/png,image/jpeg,image/webp" multiple={multiple} onChange={(event) => onChange(multiple ? [...event.target.files].slice(0, 3) : event.target.files?.[0] ?? null)} />
    </div>
  )
}

function Cotizar() {
  const location = useLocation()
  const [products, setProducts] = useState([])
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '', company: '', district: '' })
  const [message, setMessage] = useState(location.state?.description || '')
  const [item, setItem] = useState(initialItem)
  const [designBrief, setDesignBrief] = useState('')
  const [installationNotes, setInstallationNotes] = useState('')
  const [serviceAddress, setServiceAddress] = useState('')
  const [logo, setLogo] = useState(null)
  const [references, setReferences] = useState([])
  const [spacePhoto, setSpacePhoto] = useState(null)
  const [imageConsent, setImageConsent] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [calculation, setCalculation] = useState(null)
  const [quote, setQuote] = useState(null)
  const [stage, setStage] = useState(1)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const [uploadWarning, setUploadWarning] = useState('')

  useEffect(() => {
    salesApi.products()
      .then((data) => {
        setProducts(data)
        if (data[0]) setItem((current) => ({ ...current, productId: current.productId || data[0].id }))
      })
      .catch((error) => setNotice({ type: 'error', text: `${error.message} Inténtalo nuevamente en unos minutos.` }))
  }, [])

  const selectedProduct = useMemo(() => products.find((product) => product.id === item.productId), [item.productId, products])
  const selectedImages = [logo, ...references, spacePhoto].filter(Boolean)
  const usesDemoPrice = calculation?.priceRule?.isDemo

  const updateCustomer = ({ target: { name, value } }) => setCustomer((current) => ({ ...current, [name]: value }))
  const updateItem = ({ target: { name, value, type, checked } }) => {
    setCalculation(null)
    setItem((current) => {
      if (name === 'installationRequired') return { ...current, installationRequired: checked, includeTransport: checked }
      return { ...current, [name]: type === 'checkbox' ? checked : value }
    })
  }

  const transcribeAudio = async (event) => {
    const audio = event.target.files?.[0]
    event.target.value = ''
    if (!audio) return
    setBusy('transcribe'); setNotice(null)
    try {
      const result = await salesApi.transcribeAudio(audio)
      setMessage((current) => [current.trim(), result.text].filter(Boolean).join('\n'))
      setNotice({ type: 'success', text: 'Convertimos tu audio en texto. Revísalo y añade cualquier detalle que falte.' })
    } catch (error) {
      setNotice({ type: 'warning', text: error.message })
    } finally { setBusy('') }
  }

  const continueFromRequest = async (event) => {
    event.preventDefault()
    if (!item.productId || message.trim().length < 10) {
      setNotice({ type: 'error', text: 'Selecciona un producto y cuéntanos tu idea con un poco más de detalle.' })
      return
    }
    setBusy('analyze'); setNotice(null)
    try {
      const result = await salesApi.analyze(message)
      const requirements = result.requirements
      const guessed = products.find((product) => {
        const name = product.name.toLowerCase()
        const guess = requirements.productType?.toLowerCase() || ''
        return name.includes(guess) || guess.includes(name)
      })
      setAnalysis(result)
      setItem((current) => ({
        ...current,
        productId: guessed?.id || current.productId,
        widthM: requirements.widthM ?? current.widthM,
        heightM: requirements.heightM ?? current.heightM,
        quantity: requirements.quantity ?? current.quantity,
        installationRequired: requirements.installationRequired ?? current.installationRequired,
        includeTransport: requirements.installationRequired ?? current.includeTransport,
      }))
    } catch {
      setNotice({ type: 'warning', text: 'No pudimos organizar automáticamente el pedido, pero puedes continuar completando los datos.' })
    } finally {
      setBusy(''); setStage(2)
    }
  }

  const continueFromServices = (event) => {
    event.preventDefault()
    const imageError = selectedImages.map(validateImage).find(Boolean)
    if (imageError) return setNotice({ type: 'error', text: imageError })
    if (item.includeDesign && designBrief.trim().length < 10) return setNotice({ type: 'error', text: 'Cuéntanos cómo imaginas el diseño para poder prepararlo.' })
    if (item.installationRequired && (installationNotes.trim().length < 10 || serviceAddress.trim().length < 3)) return setNotice({ type: 'error', text: 'Describe el lugar e indica la dirección o distrito de instalación.' })
    if (selectedImages.length && !imageConsent) return setNotice({ type: 'error', text: 'Necesitamos tu autorización para guardar y usar las imágenes en esta cotización.' })
    setNotice(null); setStage(3)
  }

  const calculate = async (event) => {
    event.preventDefault()
    if (!customer.name.trim() || !customer.phone.trim()) return setNotice({ type: 'error', text: 'Ingresa tu nombre y un número de WhatsApp para continuar.' })
    setBusy('calculate'); setNotice(null)
    try {
      setCalculation(await salesApi.calculate(normalizeItem(item)))
      setStage(4)
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally { setBusy('') }
  }

  const uploadImages = async (quoteId) => {
    const uploads = []
    if (logo) uploads.push({ file: logo, kind: 'LOGO', description: designBrief })
    references.forEach((file) => uploads.push({ file, kind: 'REFERENCE', description: designBrief }))
    if (spacePhoto) uploads.push({ file: spacePhoto, kind: 'INSTALLATION_SPACE', description: installationNotes })
    const results = await Promise.allSettled(uploads.map((entry) => salesApi.uploadQuoteAttachment(quoteId, entry)))
    return results.filter((result) => result.status === 'rejected').length
  }

  const saveQuote = async () => {
    setBusy('save'); setNotice(null)
    try {
      const cleanCustomer = Object.fromEntries(Object.entries(customer).filter(([, value]) => String(value).trim()))
      const savedCustomer = await salesApi.createCustomer(cleanCustomer)
      const savedQuote = await salesApi.createQuote({
        customerId: savedCustomer.id,
        sourceText: message,
        notes: analysis?.requirements?.notes?.join(' · ') || undefined,
        designBrief: item.includeDesign ? designBrief : undefined,
        installationNotes: item.installationRequired ? installationNotes : undefined,
        serviceAddress: item.installationRequired ? serviceAddress : undefined,
        validDays: 15,
        items: [normalizeItem(item)],
      })
      const failedUploads = await uploadImages(savedQuote.id)
      if (failedUploads) setUploadWarning(`${failedUploads} imagen(es) no pudieron adjuntarse. Puedes enviarlas por WhatsApp.`)
      setQuote(savedQuote)
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally { setBusy('') }
  }

  const advanceMessage = selectedProduct?.pricingMode === 'FIXED' && !usesDemoPrice
    ? ` y coordinar el adelanto de ${money.format(Number(quote?.total ?? 0) * 0.5)}`
    : ' y coordinar el adelanto'
  const whatsappLink = quote ? createWhatsAppLink({ message: `Hola Joker 👋 Acabo de registrar la solicitud ${quote.number} para ${selectedProduct?.name || 'mi proyecto'}. Quisiera confirmar los detalles${advanceMessage}.` }) : '#'

  return (
    <section className="quote-flow quote-flow--public" aria-labelledby="quote-flow-title">
      <header className="quote-flow__intro"><p className="quote-flow__kicker">Cuéntanos tu proyecto</p><h1 id="quote-flow-title">Solicita tu cotización.</h1><p>Completa los datos que tengas. Las fotos son opcionales y podrás confirmar todo directamente por WhatsApp.</p></header>
      <nav className="quote-steps" aria-label="Progreso de la solicitud">{['Pedido', 'Servicios', 'Contacto', 'Confirmación'].map((label, index) => <span key={label} className={stage >= index + 1 ? 'is-active' : ''}><b>{index + 1}</b>{label}</span>)}</nav>
      {notice && <div className={`sales-notice sales-notice--${notice.type}`} role="alert">{notice.text}</div>}

      {stage === 1 && <form className="sales-card" onSubmit={continueFromRequest}>
        <div className="sales-card__heading"><div><span>Paso 1</span><h2>¿Qué necesitas?</h2></div><small>* Campos obligatorios</small></div>
        <div className="sales-grid sales-grid--3 quote-product-fields"><label>Producto *<select name="productId" value={item.productId} onChange={updateItem} required>{products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label><label>Cantidad *<input name="quantity" type="number" min="1" step="1" value={item.quantity} onChange={updateItem} required /></label><div className="quote-dimensions"><label>Ancho en metros<input name="widthM" type="number" min="0.01" step="0.01" value={item.widthM} onChange={updateItem} placeholder="2.00" /></label><label>Alto en metros<input name="heightM" type="number" min="0.01" step="0.01" value={item.heightM} onChange={updateItem} placeholder="0.80" /></label></div></div>
        <label>Explícanos tu pedido *<textarea value={message} onChange={(event) => setMessage(event.target.value)} rows="6" placeholder="Ejemplo: Quiero un letrero luminoso para la fachada de mi negocio. Me gustaría que use los colores de mi marca…" required /></label>
        <div className="audio-input"><div><strong>¿Prefieres contarlo por audio?</strong><span>Lo convertiremos en texto para completar tu solicitud.</span></div><label className={`sales-button sales-button--secondary ${busy === 'transcribe' ? 'is-disabled' : ''}`}>{busy === 'transcribe' ? 'Transcribiendo…' : 'Subir audio'}<input type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,audio/opus,video/mp4,.mp3,.m4a,.wav,.webm,.ogg,.opus" onChange={transcribeAudio} disabled={Boolean(busy)} /></label></div>
        <div className="sales-actions"><button className="sales-button" disabled={busy === 'analyze'}>{busy === 'analyze' ? 'Organizando pedido…' : 'Continuar'}</button></div>
      </form>}

      {stage === 2 && <form className="sales-card" onSubmit={continueFromServices}>
        <div className="sales-card__heading"><div><span>Paso 2</span><h2>Diseño e instalación</h2></div><button className="sales-text-button" type="button" onClick={() => setStage(1)}>Volver al pedido</button></div>
        <div className="quote-service-choice"><label><input name="includeDesign" type="checkbox" checked={item.includeDesign} onChange={updateItem} /><span><strong>Necesito apoyo con el diseño</strong><small>Prepararemos la idea usando tu logo y referencias.</small></span></label>{item.includeDesign && <div className="quote-service-details"><label>¿Cómo imaginas el diseño? *<textarea value={designBrief} onChange={(event) => setDesignBrief(event.target.value)} rows="4" placeholder="Colores, estilo, iluminación, texto que debe aparecer o ejemplos que te gusten…" required /></label><div className="quote-files-grid"><FileField id="quote-logo" label="Logo" hint="PNG, JPG o WebP · opcional" file={logo} onChange={setLogo} /><FileField id="quote-references" label="Imágenes de referencia" hint="Hasta 3 imágenes · opcional" files={references} multiple onChange={setReferences} /></div></div>}</div>
        <div className="quote-service-choice"><label><input name="installationRequired" type="checkbox" checked={item.installationRequired} onChange={updateItem} /><span><strong>Necesito instalación</strong><small>La ubicación nos ayuda a calcular movilidad, dificultad y viáticos.</small></span></label>{item.installationRequired && <div className="quote-service-details"><div className="sales-grid sales-grid--2"><label>Dirección o distrito *<input value={serviceAddress} onChange={(event) => setServiceAddress(event.target.value)} placeholder="Ejemplo: El Tambo, cerca al parque…" required /></label><label>Describe el lugar *<textarea value={installationNotes} onChange={(event) => setInstallationNotes(event.target.value)} rows="3" placeholder="Fachada, pared, altura aproximada, acceso o alguna dificultad…" required /></label></div><FileField id="quote-space" label="Foto del lugar" hint="Opcional; ayuda a preparar una propuesta más realista" file={spacePhoto} onChange={setSpacePhoto} /></div>}</div>
        {selectedImages.length > 0 && <label className="quote-image-consent"><input type="checkbox" checked={imageConsent} onChange={(event) => setImageConsent(event.target.checked)} /><span>Autorizo que estas imágenes se guarden y se utilicen únicamente para preparar mi cotización y propuesta visual.</span></label>}
        <p className="quote-privacy">Si no tienes el logo o la foto del lugar ahora, puedes continuar y enviarlos después por WhatsApp.</p><div className="sales-actions"><button className="sales-button">Continuar</button></div>
      </form>}

      {stage === 3 && <form className="sales-card" onSubmit={calculate}>
        <div className="sales-card__heading"><div><span>Paso 3</span><h2>¿Cómo te contactamos?</h2></div><button className="sales-text-button" type="button" onClick={() => setStage(2)}>Editar servicios</button></div>
        <div className="sales-grid sales-grid--2"><label>Nombre *<input name="name" value={customer.name} onChange={updateCustomer} autoComplete="name" required /></label><label>WhatsApp *<input name="phone" value={customer.phone} onChange={updateCustomer} autoComplete="tel" inputMode="tel" placeholder="999 999 999" required /></label><label>Correo electrónico<input name="email" type="email" value={customer.email} onChange={updateCustomer} autoComplete="email" /></label><label>Empresa o negocio<input name="company" value={customer.company} onChange={updateCustomer} /></label><label>Distrito<input name="district" value={customer.district} onChange={updateCustomer} autoComplete="address-level2" /></label></div>
        <p className="quote-privacy">Usaremos estos datos para responder sobre esta solicitud y coordinar la confirmación del pedido.</p><div className="sales-actions"><button className="sales-button" disabled={busy === 'calculate'}>{busy === 'calculate' ? 'Preparando resumen…' : 'Revisar solicitud'}</button></div>
      </form>}

      {stage === 4 && calculation && !quote && <section className="sales-card quote-review">
        <div className="sales-card__heading"><div><span>Paso 4</span><h2>Revisa tu solicitud</h2></div><button className="sales-text-button" type="button" onClick={() => setStage(3)}>Editar contacto</button></div>
        <div className="quote-review__product"><div><small>Tu pedido</small><strong>{calculation.product.name}</strong><span>{item.widthM && item.heightM ? `${item.widthM} m × ${item.heightM} m · ` : ''}{item.quantity} unidad(es)</span></div>{!usesDemoPrice && <b>{money.format(calculation.total)}</b>}</div>
        <dl className="quote-summary-list"><div><dt>Diseño</dt><dd>{item.includeDesign ? 'Incluido' : 'No solicitado'}</dd></div><div><dt>Instalación</dt><dd>{item.installationRequired ? serviceAddress : 'No solicitada'}</dd></div><div><dt>Imágenes adjuntas</dt><dd>{selectedImages.length}</dd></div><div><dt>Contacto</dt><dd>{customer.name} · {customer.phone}</dd></div></dl>
        {usesDemoPrice ? <div className="quote-price-pending"><strong>Confirmaremos el precio por WhatsApp</strong><span>Estamos terminando de configurar las tarifas. Tu solicitud quedará registrada sin mostrarte un monto provisional incorrecto.</span></div> : <p className="quote-estimate-note">El monto es una estimación según los datos enviados. Confirmaremos medidas, instalación y adelanto por WhatsApp.</p>}
        <div className="sales-actions"><button className="sales-button" type="button" onClick={saveQuote} disabled={busy === 'save'}>{busy === 'save' ? 'Enviando solicitud…' : 'Solicitar cotización'}</button></div>
      </section>}

      {stage === 4 && quote && <section className="sales-card quote-success"><span className="quote-success__mark">✓</span><p>Solicitud registrada</p><h2>{quote.number}</h2>{!usesDemoPrice && <strong>{money.format(Number(quote.total))}</strong>}<p>Ahora abre WhatsApp para confirmar los detalles del pedido y coordinar el adelanto.</p>{uploadWarning && <div className="sales-notice sales-notice--warning">{uploadWarning}</div>}<div className="sales-actions sales-actions--center"><a className="sales-button quote-whatsapp-action" href={whatsappLink} target="_blank" rel="noreferrer">Confirmar por WhatsApp</a>{!usesDemoPrice && <a className="sales-button sales-button--secondary" href={salesApi.pdfUrl(quote.id)}>Descargar cotización</a>}</div></section>}
    </section>
  )
}

export default Cotizar
