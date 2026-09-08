import { describe, expect, it } from 'vitest'
import { updatePriceRuleSchema } from './products.schemas.js'

const validRule = {
  name: 'Tarifa septiembre',
  basePrice: 100,
  pricePerSquareMeter: 250,
  designFee: 40,
  installationFee: 120,
  transportFee: 30,
  marginPercent: 20,
  igvPercent: 18,
}

describe('updatePriceRuleSchema', () => {
  it('acepta una tarifa comercial completa', () => {
    expect(updatePriceRuleSchema.parse(validRule)).toEqual(validRule)
  })

  it('rechaza importes negativos', () => {
    expect(() => updatePriceRuleSchema.parse({ ...validRule, basePrice: -1 })).toThrow()
  })

  it('rechaza porcentajes de IGV mayores a 100', () => {
    expect(() => updatePriceRuleSchema.parse({ ...validRule, igvPercent: 101 })).toThrow()
  })
})
