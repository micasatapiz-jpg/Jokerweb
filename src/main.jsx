import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/global.css'
import './styles/sales.css'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sequence-cache-sw.js').catch(() => {
    // La aplicación continúa usando el caché HTTP normal si no está disponible.
  })
}

if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {
    // Cache Storage sigue funcionando aunque el navegador no conceda persistencia.
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
