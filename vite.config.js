import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { seoPlugin } from './scripts/seoPlugin.js'
import { DEFAULT_SITE_URL } from './src/config/seo.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), seoPlugin(env.VITE_SITE_URL || DEFAULT_SITE_URL, env.VITE_GOOGLE_SITE_VERIFICATION || '')],
    build: { manifest: true },
  }
})
