import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildWhatsAppLink } from './whatsappLink.js'

test('uses the direct WhatsApp endpoint and preserves complete Unicode messages', () => {
  const message = '¡Hola, Joker! 👋 Me interesa un letrero. ¿Cotizamos? 💡\n🖨️ 🎨 📍 🎉 ✨ ✅'
  const link = buildWhatsAppLink('51972044482', message)
  const url = new URL(link)
  assert.equal(url.origin, 'https://api.whatsapp.com')
  assert.equal(url.pathname, '/send')
  assert.equal(url.searchParams.get('phone'), '51972044482')
  assert.equal(url.searchParams.get('text'), message)
  assert.ok(link.includes('%F0%9F%91%8B'))
  assert.ok(link.includes('%F0%9F%92%A1'))
  assert.ok(!link.includes('%EF%BF%BD'))
})

test('customer punctuation and URLs stay inside the message parameter', () => {
  const message = 'Diseño: Café + Botica & Clínica #1 = 50%\nhttps://ejemplo.com/?a=1&b=2 👩🏽‍🎨'
  const url = new URL(buildWhatsAppLink('51972044482', message))
  assert.deepEqual([...url.searchParams.keys()], ['phone', 'text'])
  assert.equal(url.searchParams.get('text'), message)
})

test('every configured service message preserves its emojis', () => {
  const source = readFileSync(new URL('../config/siteConfig.js', import.meta.url), 'utf8')
  const messages = source.match(/'¡Hola, Joker![^'\n]+'/g)
  assert.equal(messages.length, 9)
  for (const literal of messages) {
    const message = literal.slice(1, -1)
    assert.ok(message.includes('👋'))
    assert.ok(!message.includes('\uFFFD'))
    assert.equal(new URL(buildWhatsAppLink('51972044482', message)).searchParams.get('text'), message)
  }
})
