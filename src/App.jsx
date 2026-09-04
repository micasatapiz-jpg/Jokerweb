import { Route, Routes } from 'react-router-dom'
import Footer from './components/Footer'
import Navbar from './components/Navbar'
import WhatsAppButton from './components/WhatsAppButton'
import Catalogo from './pages/Catalogo'
import Contacto from './pages/Contacto'
import Home from './pages/Home'
import Letreros from './pages/Letreros'
import Nosotros from './pages/Nosotros'
import ProductosFamilia from './pages/ProductosFamilia'

function App() {
  return (
    <div className="app">
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/servicios/letreros" element={<Letreros />} />
          <Route path="/servicios/:familia" element={<ProductosFamilia />} />
          <Route path="/nosotros" element={<Nosotros />} />
          <Route path="/contacto" element={<Contacto />} />
        </Routes>
      </main>
      <Footer />
      <WhatsAppButton
        servicio="general"
        origen="floating"
        className="whatsapp-button--floating"
      />
    </div>
  )
}

export default App
