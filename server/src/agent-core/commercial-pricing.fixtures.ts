import { productConfigurationSchema } from './product-configuration.schema.js'
import type { CommercialPricing } from './commercial-pricing.js'

// FICTITIOUS test inputs only. Never imported by runtime services or seeds.
export const fictitiousTariff = { unitPrice: 10, setupPrice: 5, variants: { standard: 12, plus: 20 }, addOns: { finish: 3 }, taxPercent: 0 }
export function commercialRulesFixture(saleMode: CommercialPricing['saleMode'] = 'AREA', tariffId = '11111111-1111-4111-8111-111111111199') {
  const measurements = (saleMode === 'AREA' ? ['width', 'height'] : saleMode === 'LINEAR' ? ['length'] : []).map(field => ({
    field, unitField: `${field}Unit`, canonicalUnit: 'm', acceptedUnits: ['m', 'cm'], conversionRules: { m: 1, cm: 0.01 }, min: 0.01, max: 100,
  }))
  const fields: Record<string, unknown> = { quantity: { type: 'number', min: 1, max: 100, question: '¿Cuántas unidades?' },
    finish: { type: 'boolean', question: '¿Deseas el acabado opcional?' } }
  for (const m of measurements) {
    fields[m.field] = { type: 'number', min: 0.01, question: `Confirma ${m.field}.` }
    fields[m.unitField] = { type: 'choice', choices: ['m', 'cm'], question: `¿En qué unidad está ${m.field}?` }
  }
  if (saleMode === 'PACKAGE') fields.variant = { type: 'choice', choices: ['standard', 'plus'], question: '¿Qué variante prefieres?' }
  return productConfigurationSchema.parse({
    commercialPricing: { ruleRef: 'GENERIC_V1', tariffId, saleMode,
      quantity: { field: saleMode === 'FIXED' ? null : 'quantity', constant: saleMode === 'FIXED' ? 1 : null, integer: true, min: 1, max: 100 },
      measurements, variant: saleMode === 'PACKAGE' ? { field: 'variant', options: ['standard', 'plus'] } : null,
      addOns: [{ field: 'finish', rateKey: 'finish', basis: 'PER_ORDER' }], minimumSubtotal: 0, maximumSubtotal: 100000,
    }, quotationRules: { pricingEngine: 'GENERIC_V1', validityDays: 7, fields },
  })
}
export const commercialValuesFixture = (mode: CommercialPricing['saleMode']) => ({ quantity: 3, width: 200, widthUnit: 'cm', height: 1, heightUnit: 'm', length: 2, lengthUnit: 'm', variant: 'plus' })
