import { describe, expect, it } from 'vitest'
import { calculateDeterministicPrice } from './pricing.calculator.js'

const rule = {
  basePrice: 120,
  pricePerSquareMeter: 310,
  designFee: 50,
  installationFee: 160,
  transportFee: 35,
  marginPercent: 20,
  igvPercent: 18,
}

describe('calculateDeterministicPrice', () => {
  it('calcula el caso principal sin delegar operaciones a la IA', () => {
    const result = calculateDeterministicPrice(
      {
        quantity: 1,
        widthM: 3,
        heightM: 1.2,
        installationRequired: true,
        includeDesign: true,
        includeTransport: true,
        discountPercent: 0,
      },
      rule,
    )

    expect(result.areaM2).toBe(3.6)
    expect(result.components.area).toBe(1116)
    expect(result.unitPrice).toBe(1777.2)
    expect(result.tax).toBe(319.9)
    expect(result.total).toBe(2097.1)
  })

  it('multiplica el precio unitario por la cantidad', () => {
    const result = calculateDeterministicPrice(
      {
        quantity: 2,
        widthM: 1,
        heightM: 1,
        installationRequired: false,
        includeDesign: false,
        includeTransport: false,
        discountPercent: 0,
      },
      rule,
    )

    expect(result.subtotal).toBe(1032)
    expect(result.total).toBe(1217.76)
  })

  it('aplica descuento antes del IGV', () => {
    const result = calculateDeterministicPrice(
      {
        quantity: 1,
        installationRequired: false,
        includeDesign: false,
        includeTransport: false,
        discountPercent: 10,
      },
      rule,
    )

    expect(result.subtotal).toBe(144)
    expect(result.discount).toBe(14.4)
    expect(result.total).toBe(152.93)
  })

  it('rechaza una cantidad inválida', () => {
    expect(() =>
      calculateDeterministicPrice(
        {
          quantity: 0,
          installationRequired: false,
          includeDesign: false,
          includeTransport: false,
          discountPercent: 0,
        },
        rule,
      ),
    ).toThrow('La cantidad debe ser mayor que cero.')
  })

  it('rechaza dimensiones incompletas', () => {
    expect(() =>
      calculateDeterministicPrice(
        {
          quantity: 1,
          widthM: 2,
          installationRequired: false,
          includeDesign: false,
          includeTransport: false,
          discountPercent: 0,
        },
        rule,
      ),
    ).toThrow('El ancho y el alto deben ingresarse juntos.')
  })
})

