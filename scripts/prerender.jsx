import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import App from '../src/App.jsx'

export function renderPage(pathname) {
  return renderToString(<StaticRouter location={pathname}><App /></StaticRouter>)
}
