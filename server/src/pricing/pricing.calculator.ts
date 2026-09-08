import type { CalculateQuoteInput, PricingResult, PricingRuleSnapshot } from './pricing.schemas.js'

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function decimal(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function calculateDeterministicPrice(
  input: Omit<CalculateQuoteInput, 'productId'>,
  rule: PricingRuleSnapshot,
): PricingResult {
  const numericValues = [
    input.quantity,
    input.widthM ?? 0,
    input.heightM ?? 0,
    input.discountPercent,
    ...Object.values(rule),
  ]

  if (numericValues.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Los valores para calcular la cotización deben ser números no negativos.')
  }
  if (input.quantity <= 0) throw new Error('La cantidad debe ser mayor que cero.')
  if ((input.widthM && !input.heightM) || (!input.widthM && input.heightM)) {
    throw new Error('El ancho y el alto deben ingresarse juntos.')
  }
  if (input.discountPercent > 100) throw new Error('El descuento no puede superar el 100%.')

  const areaM2 = input.widthM && input.heightM ? decimal(input.widthM * input.heightM, 4) : null
  const base = money(rule.basePrice)
  const area = money((areaM2 ?? 0) * rule.pricePerSquareMeter)
  const design = input.includeDesign ? money(rule.designFee) : 0
  const installation = input.installationRequired ? money(rule.installationFee) : 0
  const transport = input.includeTransport ? money(rule.transportFee) : 0
  const beforeMarginPerUnit = money(base + area + design + installation + transport)
  const margin = money(beforeMarginPerUnit * (rule.marginPercent / 100))
  const unitPrice = money(beforeMarginPerUnit + margin)
  const subtotal = money(unitPrice * input.quantity)
  const discount = money(subtotal * (input.discountPercent / 100))
  const taxable = money(subtotal - discount)
  const tax = money(taxable * (rule.igvPercent / 100))
  const total = money(taxable + tax)

  return {
    areaM2,
    quantity: input.quantity,
    components: { base, area, design, installation, transport, margin },
    unitPrice,
    subtotal,
    discount,
    tax,
    total,
  }
}

