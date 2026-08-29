import { Route, Routes } from 'react-router-dom'
import Footer from './components/Footer'
import Navbar from './components/Navbar'
import WhatsAppButton from './components/WhatsAppButton'
import Catalogo from './pages/Catalogo'
import Contacto from './pages/Contacto'
import Home from './pages/Home'
import Nosotros from './pages/Nosotros'

function App() {
  return (
    <div className="app">
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalogo" element={<Catalogo />} />
          <Route path="/nosotros" element={<Nosotros />} />
          <Route path="/contacto" element={<Contacto />} />
        </Routes>
      </main>
      <Footer />
      <WhatsAppButton
        mensaje="Hola, quiero información sobre sus productos publicitarios."
        className="whatsapp-button--floating"
      />
    </div>
  )
}

export default App
