import { describe, expect, it } from 'vitest'
import { QuoteMessageService } from './quote-message.service.js'

function createService(config: Record<string, string> = {}) {
  const quotes = {
    get: async () => ({
      id: 'quote-id',
      number: 'COT-2026-0001',
      total: 1180,
      currency: 'PEN',
      customer: { name: 'Fernando Pérez' },
      items: [{
        description: 'Letrero luminoso',
        product: { pricingMode: 'CUSTOM_COMPLEX' },
        pricingBreakdown: { components: { installation: 160, transport: 35 } },
      }],
    }),
  }
  const configService = {
    get: (key: string, fallback?: string) => config[key] ?? fallback,
  }
  return new QuoteMessageService(quotes as never, configService as never)
}

describe('QuoteMessageService', () => {
  it('usa el total real y no inventa una tienda cuando las visitas están desactivadas', async () => {
    const result = await createService().build('quote-id')
    expect(result.text).toContain('S/ 1,180.00')
    expect(result.text).toContain('coordinamos una llamada o una reunión')
    expect(result.text).not.toContain('Casa Tapiz')
  })

  it('para un precio fijo solicita 50% y no ofrece negociar el presupuesto', async () => {
    const quotes = {
      get: async () => ({
        id: 'quote-fixed', number: 'COT-2026-0002', total: 100, currency: 'PEN',
        customer: { name: 'Ana' },
        items: [{
          description: 'Impresión en vinil',
          product: { pricingMode: 'FIXED' },
          pricingBreakdown: { components: {} },
        }],
      }),
    }
    const config = { get: (_key: string, fallback?: string) => fallback }
    const result = await new QuoteMessageService(quotes as never, config as never).build('quote-fixed')
    expect(result.text).toContain('adelanto del 50%')
    expect(result.text).not.toContain('de acuerdo con tu presupuesto')
    expect(result.pricingMode).toBe('FIXED')
  })

  it('ofrece Casa Tapiz únicamente cuando está habilitado y con cita previa', async () => {
    const result = await createService({
      QUOTE_VISIT_ENABLED: 'true',
      QUOTE_VISIT_LABEL: 'Casa Tapiz',
      QUOTE_VISIT_REQUIRES_APPOINTMENT: 'true',
    }).build('quote-id')
    expect(result.text).toContain('Casa Tapiz con cita previa')
    expect(result.visit.enabled).toBe(true)
  })
})
