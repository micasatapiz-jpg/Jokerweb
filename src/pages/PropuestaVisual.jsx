import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { salesApi } from '../services/salesApi'

const acceptedTypes = ['image/png', 'image/jpeg', 'image/webp']

function validateImage(file) {
  if (!file) return 'Selecciona una imagen.'
  if (!acceptedTypes.includes(file.type)) return 'Usa una imagen PNG, JPG o WebP.'
  if (file.size > 10 * 1024 * 1024) return 'La imagen debe pesar menos de 10 MB.'
  return ''
}

function ImagePicker({ id, label, hint, file, onChange }) {
  const preview = useMemo(() => file ? URL.createObjectURL(file) : '', [file])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  return (
    <label className="visual-upload" htmlFor={id}>
      {preview ? <img src={preview} alt="Vista previa del archivo seleccionado" /> : <span aria-hidden="true">＋</span>}
      <strong>{file?.name || label}</strong>
      <small>{hint}</small>
      <input id={id} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
    </label>
  )
}

function PropuestaVisual() {
  const location = useLocation()
  const [description, setDescription] = useState(location.state?.description || '')
  const [logo, setLogo] = useState(null)
  const [openaiConsent, setOpenaiConsent] = useState(false)
  const [proposal, setProposal] = useState(null)
  const [mode, setMode] = useState('')
  const [spaceConsent, setSpaceConsent] = useState(false)
  const [spacePhoto, setSpacePhoto] = useState(null)
  const [notes, setNotes] = useState('')
  const [resultUrl, setResultUrl] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)

  const analyze = async (event) => {
    event.preventDefault()
    const imageError = validateImage(logo)
    if (description.trim().length < 10 || imageError || !openaiConsent) {
      setNotice({ type: 'error', text: imageError || (!openaiConsent ? 'Acepta el envío del logo a OpenAI para continuar.' : 'Describe el trabajo con al menos 10 caracteres.') })
      return
    }
    const form = new FormData()
    form.append('description', description)
    form.append('openaiConsent', 'true')
    form.append('logo', logo)
    setBusy('analyze')
    setNotice(null)
    try {
      setProposal(await salesApi.createVisualProposal(form))
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setBusy('')
    }
  }

  const chooseMode = (nextMode) => {
    setMode(nextMode)
    if (nextMode === 'NEUTRAL') {
      setSpaceConsent(false)
      setSpacePhoto(null)
    }
  }

  const generate = async (event) => {
    event.preventDefault()
    if (!mode) {
      setNotice({ type: 'error', text: 'Elige si prefieres fondo neutro o una foto del local.' })
      return
    }
    if (mode === 'CONTEXTUAL') {
      const imageError = validateImage(spacePhoto)
      if (!spaceConsent || imageError) {
        setNotice({ type: 'error', text: imageError || 'Acepta el uso de la foto del espacio para continuar.' })
        return
      }
    }
    const form = new FormData()
    form.append('mode', mode)
    form.append('spacePhotoConsent', String(mode === 'CONTEXTUAL' && spaceConsent))
    if (notes.trim()) form.append('notes', notes)
    if (mode === 'CONTEXTUAL') form.append('spacePhoto', spacePhoto)
    setBusy('generate')
    setNotice(null)
    try {
      await salesApi.generateVisualProposal(proposal.id, form)
      setResultUrl(`${salesApi.visualProposalImageUrl(proposal.id)}?v=${Date.now()}`)
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setBusy('')
    }
  }

  const restart = () => {
    setProposal(null)
    setMode('')
    setSpaceConsent(false)
    setSpacePhoto(null)
    setResultUrl('')
    setNotice(null)
  }

  return (
    <section className="quote-flow visual-flow" aria-labelledby="visual-title">
      <header className="quote-flow__intro">
        <p className="quote-flow__kicker">Propuesta con IA</p>
        <h1 id="visual-title">Imagina el resultado antes de fabricarlo.</h1>
        <p>Sube el logo y cuéntanos la idea. La foto del local es opcional y solo se solicitará si eliges usarla.</p>
      </header>

      <nav className="quote-steps visual-steps" aria-label="Progreso de la propuesta">
        {['Logo', 'Presentación', 'Resultado'].map((label, index) => {
          const active = index === 0 || (index === 1 && proposal) || (index === 2 && resultUrl)
          return <span key={label} className={active ? 'is-active' : ''}><b>{index + 1}</b>{label}</span>
        })}
      </nav>

      {notice && <div className={`sales-notice sales-notice--${notice.type}`} role="alert">{notice.text}</div>}

      {!proposal && (
        <form className="sales-card visual-start" onSubmit={analyze}>
          <div className="sales-card__heading"><div><span>Paso 1</span><h2>Logo e idea del cliente</h2></div><Link className="sales-text-button" to="/cotizar">Volver a cotizar</Link></div>
          <div className="visual-start__grid">
            <ImagePicker id="logo-file" label="Seleccionar logo" hint="PNG, JPG o WebP · máximo 10 MB" file={logo} onChange={setLogo} />
            <div className="visual-description">
              <label>¿Qué desea visualizar? *
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows="6" placeholder="Ejemplo: Quiero un letrero luminoso con letras corpóreas..." required />
              </label>
              <label className="visual-consent"><input type="checkbox" checked={openaiConsent} onChange={(event) => setOpenaiConsent(event.target.checked)} /><span>Acepto que el logo y la descripción se envíen a OpenAI para crear esta propuesta.</span></label>
            </div>
          </div>
          <p className="visual-privacy">La imagen se usa para esta propuesta. La clave de OpenAI permanece únicamente en el servidor local.</p>
          <div className="sales-actions"><button className="sales-button" disabled={busy === 'analyze'}>{busy === 'analyze' ? 'Analizando el logo…' : 'Analizar logo'}</button></div>
        </form>
      )}

      {proposal && !resultUrl && (
        <form className="sales-card" onSubmit={generate}>
          <div className="sales-card__heading"><div><span>Paso 2</span><h2>¿Cómo desea ver la propuesta?</h2></div><button className="sales-text-button" type="button" onClick={restart}>Cambiar logo</button></div>
          <div className="visual-analysis">
            <p>{proposal.analysis.summary}</p>
            <div><small>Recomendación</small><strong>{proposal.analysis.recommendedSign}</strong></div>
            {proposal.analysis.designNotes?.length > 0 && <ul>{proposal.analysis.designNotes.map((note) => <li key={note}>{note}</li>)}</ul>}
          </div>

          <fieldset className="visual-mode">
            <legend>Elige una presentación *</legend>
            <button className={mode === 'NEUTRAL' ? 'is-selected' : ''} type="button" onClick={() => chooseMode('NEUTRAL')} aria-pressed={mode === 'NEUTRAL'}>
              <span>Fondo neutro</span><strong>No necesito enviar una foto del local</strong><small>Ideal para revisar acabado, volumen e iluminación.</small>
            </button>
            <button className={mode === 'CONTEXTUAL' ? 'is-selected' : ''} type="button" onClick={() => chooseMode('CONTEXTUAL')} aria-pressed={mode === 'CONTEXTUAL'}>
              <span>Verlo en mi local</span><strong>Quiero usar una foto del espacio</strong><small>La IA integrará el letrero en el lugar real.</small>
            </button>
          </fieldset>

          {mode === 'CONTEXTUAL' && (
            <div className="visual-space">
              <ImagePicker id="space-file" label="Seleccionar foto del espacio" hint="Toma una foto frontal y bien iluminada" file={spacePhoto} onChange={setSpacePhoto} />
              <label className="visual-consent"><input type="checkbox" checked={spaceConsent} onChange={(event) => setSpaceConsent(event.target.checked)} /><span>Acepto enviar esta foto del espacio a OpenAI para colocar la propuesta visual.</span></label>
            </div>
          )}

          {proposal.analysis.questions?.length > 0 && <div className="visual-questions"><strong>Para afinar la propuesta</strong><ul>{proposal.analysis.questions.map((question) => <li key={question}>{question}</li>)}</ul></div>}
          <label>Detalles adicionales (opcional)<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows="3" placeholder="Ejemplo: iluminación cálida, acabado negro mate..." /></label>
          <div className="sales-actions"><button className="sales-button" disabled={busy === 'generate'}>{busy === 'generate' ? 'Generando propuesta…' : 'Generar propuesta visual'}</button></div>
        </form>
      )}

      {resultUrl && (
        <section className="sales-card visual-result">
          <div className="sales-card__heading"><div><span>Paso 3</span><h2>Propuesta lista</h2></div><button className="sales-text-button" type="button" onClick={() => setResultUrl('')}>Hacer ajustes</button></div>
          <figure><img src={resultUrl} alt="Propuesta visual generada para el letrero" /><figcaption>Vista conceptual generada con IA. No reemplaza un plano técnico ni confirma medidas finales.</figcaption></figure>
          <div className="sales-actions"><a className="sales-button sales-button--secondary" href={resultUrl} download={`propuesta-${proposal.id}.png`}>Descargar imagen</a><Link className="sales-button" to="/cotizar" state={{ description }}>Continuar cotización</Link></div>
        </section>
      )}
    </section>
  )
}

export default PropuestaVisual
