import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Footer from './components/Footer'
import Navbar from './components/Navbar'
import WhatsAppButton from './components/WhatsAppButton'
import Catalogo from './pages/Catalogo'
import Contacto from './pages/Contacto'
import ConfigurarPrecios from './pages/ConfigurarPrecios'
import Cotizar from './pages/Cotizar'
import DetalleCotizacion from './pages/DetalleCotizacion'
import Home from './pages/Home'
import Letreros from './pages/Letreros'
import Nosotros from './pages/Nosotros'
import PanelCotizaciones from './pages/PanelCotizaciones'
import ProductosFamilia from './pages/ProductosFamilia'
import PropuestaVisual from './pages/PropuestaVisual'
import PoliticaPrivacidad from './pages/PoliticaPrivacidad'

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}

function App() {
  const { pathname } = useLocation()
  const isSalesApp = pathname.startsWith('/app')

  return (
    <div className={`app ${isSalesApp ? 'app--sales' : ''}`}>
      <ScrollToTop />
      {!isSalesApp && <Navbar />}
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/servicios/letreros" element={<Letreros />} />
          <Route path="/servicios/:familia" element={<ProductosFamilia />} />
          <Route path="/nosotros" element={<Nosotros />} />
          <Route path="/contacto" element={<Contacto />} />
          <Route path="/cotizar" element={<Cotizar />} />
          <Route path="/propuesta-visual" element={<PropuestaVisual />} />
          <Route path="/app" element={<PanelCotizaciones />} />
          <Route path="/app/precios" element={<ConfigurarPrecios />} />
          <Route path="/app/cotizaciones/:id" element={<DetalleCotizacion />} />
          <Route path="/politica-privacidad" element={<PoliticaPrivacidad />} />
        </Routes>
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
