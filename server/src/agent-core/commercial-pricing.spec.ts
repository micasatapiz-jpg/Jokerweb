import { describe, expect, it } from 'vitest'
import { calculateCommercialPrice, commercialPricingSchema } from './commercial-pricing.js'
import { commercialRulesFixture, commercialValuesFixture, fictitiousTariff } from './commercial-pricing.fixtures.js'
import { evaluateProductRules, productConfigurationSchema } from './product-configuration.schema.js'

describe('Motor comercial genérico: solo fixtures ficticios', () => {
  it.each([['AREA', 65], ['UNIT', 35], ['LINEAR', 65], ['FIXED', 15], ['PACKAGE', 65]] as const)('%s calcula de forma determinista', (mode, total) => {
    const result = calculateCommercialPrice(commercialRulesFixture(mode).commercialPricing!, fictitiousTariff, commercialValuesFixture(mode))
    expect(result).toMatchObject({ status: 'READY', calculation: { total, discount: 0 } })
  })
  it('suma setup una vez, adicional por pedido y mínimo configurado, redondeando moneda', () => {
    const rule = commercialRulesFixture('UNIT').commercialPricing!
    expect(calculateCommercialPrice(rule, { ...fictitiousTariff, taxPercent: 18 }, { quantity: 3, finish: true })).toMatchObject({ calculation: { subtotal: 38, tax: 6.84, total: 44.84 } })
    expect(calculateCommercialPrice({ ...rule, minimumSubtotal: 50 }, fictitiousTariff, { quantity: 1 })).toMatchObject({ calculation: { subtotal: 50 } })
  })
  it.each([
    { quantity: 1 }, { quantity: 1, width: 2, height: 1 },
    { quantity: 1, width: 2, widthUnit: 'yards', height: 1, heightUnit: 'm' },
    { quantity: 0, width: 2, widthUnit: 'm', height: 1, heightUnit: 'm' },
    { quantity: 1, width: 101, widthUnit: 'm', height: 1, heightUnit: 'm' },
  ])('rechaza medidas/requisitos incompletos o fuera de límites: %j', values => {
    expect(calculateCommercialPrice(commercialRulesFixture().commercialPricing!, fictitiousTariff, values).status).toBe('MISSING_DATA')
  })
  it('no adivina variantes ni adicionales sin tarifa', () => {
    const r = commercialRulesFixture('PACKAGE').commercialPricing!
    expect(calculateCommercialPrice(r, fictitiousTariff, { quantity: 1, variant: 'unknown' }).status).toBe('MISSING_DATA')
    expect(calculateCommercialPrice(r, { ...fictitiousTariff, variants: {} }, { quantity: 1, variant: 'plus' }).status).toBe('RULE_NOT_CONFIGURED')
  })
  it('rechaza fórmula arbitraria, conversión falsa y campos privilegiados', () => {
    const r = commercialRulesFixture()
    expect(() => commercialPricingSchema.parse({ ...r.commercialPricing, ruleRef: 'eval' })).toThrow()
    r.commercialPricing!.measurements[0]!.conversionRules.cm = 100
    expect(() => productConfigurationSchema.parse(r)).toThrow()
    expect(() => productConfigurationSchema.parse({ quotationRules: { fields: { discount: { type: 'number', question: 'No permitido' } } } })).toThrow()
  })
  it.each([{ isActive: false }, { validUntil: '2020-01-01T00:00:00Z' }, { validFrom: '2099-01-01T00:00:00Z' }])('no usa configuración no vigente: %j', patch => {
    expect(evaluateProductRules({ ...commercialRulesFixture(), ...patch }, {}).status).toBe('RULE_NOT_CONFIGURED')
  })
  it('autoQuote permanece desactivado y la producción nunca se habilita', () => {
    expect(commercialRulesFixture().autoQuoteEnabled).toBe(false)
    expect(commercialRulesFixture().productionRules.automaticProductionStart).toBe(false)
    expect(evaluateProductRules(null, {}).status).toBe('RULE_NOT_CONFIGURED')
  })
})
