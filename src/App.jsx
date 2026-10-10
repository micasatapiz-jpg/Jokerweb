import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Footer from './components/Footer'
import Seo from './components/Seo'
import Navbar from './components/Navbar'
import WhatsAppButton from './components/WhatsAppButton'
import Catalogo from './pages/Catalogo'
import Contacto from './pages/Contacto'
import Home from './pages/Home'
import Letreros from './pages/Letreros'
import Nosotros from './pages/Nosotros'
import ProductosFamilia from './pages/ProductosFamilia'
import PoliticaPrivacidad from './pages/PoliticaPrivacidad'

// The public landing needs no database, uploads, or AI. Legacy sales tools can
// still be developed locally with an explicit opt-in, never in the static image.
const salesEnabled = import.meta.env.VITE_ENABLE_SALES_APP === 'true'
const ConfigurarPrecios = salesEnabled ? lazy(() => import('./pages/ConfigurarPrecios')) : null
const Cotizar = salesEnabled ? lazy(() => import('./pages/Cotizar')) : null
const DetalleCotizacion = salesEnabled ? lazy(() => import('./pages/DetalleCotizacion')) : null
const PanelCotizaciones = salesEnabled ? lazy(() => import('./pages/PanelCotizaciones')) : null
const PropuestaVisual = salesEnabled ? lazy(() => import('./pages/PropuestaVisual')) : null

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}

function App() {
  const { pathname } = useLocation()
  const isSalesApp = salesEnabled && pathname.startsWith('/app')

  return (
    <div className={`app ${isSalesApp ? 'app--sales' : ''}`}>
      <Seo />
      <ScrollToTop />
      {!isSalesApp && <Navbar />}
      <main>
        <Suspense fallback={<p>Cargando…</p>}><Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/servicios/letreros" element={<Letreros />} />
          <Route path="/servicios/:familia" element={<ProductosFamilia />} />
          <Route path="/nosotros" element={<Nosotros />} />
          <Route path="/contacto" element={<Contacto />} />
          <Route path="/cotizar" element={<Navigate to="/" replace />} />
          {salesEnabled && <>
            <Route path="/propuesta-visual" element={<PropuestaVisual />} />
            <Route path="/app" element={<PanelCotizaciones />} />
            <Route path="/app/cotizaciones/nueva" element={<Cotizar />} />
            <Route path="/app/precios" element={<ConfigurarPrecios />} />
            <Route path="/app/cotizaciones/:id" element={<DetalleCotizacion />} />
          </>}
          <Route path="/politica-privacidad" element={<PoliticaPrivacidad />} />
        </Routes></Suspense>
      </main>
      {!isSalesApp && <Footer />}
      {!isSalesApp && <WhatsAppButton
        servicio="general"
        origen="floating"
        className="whatsapp-button--floating"
      />}
    </div>
  )
}

export default App
