import { z } from 'zod'
import { Prisma } from '../generated/prisma/client.js'

export const requirementKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/)
  .refine(key => !/price|precio|discount|descuento|paid|pagado|confirmed|confirmado|approval|owner|tenant|prototype|constructor|total|tax|igv|amount|monto|role|status|estado|payment|pago|readyAt|production|produccion|tariff|tarifa/i.test(key))
const bounds = { min: z.number().positive(), max: z.number().positive() }
const units = z.enum(['m', 'cm', 'mm', 'in', 'ft'])
const measurement = z.object({ field: requirementKey, unitField: requirementKey,
  canonicalUnit: units, acceptedUnits: z.array(units).min(1),
  conversionRules: z.partialRecord(units, z.number().positive()), ...bounds,
}).strict()
const unitMeters = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 }
export const commercialPricingSchema = z.object({
  ruleRef: z.literal('GENERIC_V1'), tariffId: z.uuid(),
  saleMode: z.enum(['UNIT', 'AREA', 'LINEAR', 'FIXED', 'PACKAGE']),
  quantity: z.object({ field: requirementKey.nullable(), constant: z.number().positive().nullable(),
    integer: z.boolean(), ...bounds }).strict(),
  measurements: z.array(measurement).max(2),
  variant: z.object({ field: requirementKey, options: z.array(z.string().min(1).max(80)).min(1).max(30) }).strict().nullable(),
  addOns: z.array(z.object({ field: requirementKey, rateKey: z.string().min(1).max(80),
    basis: z.enum(['PER_UNIT', 'PER_ORDER']) }).strict()).max(20),
  minimumSubtotal: z.number().nonnegative(), maximumSubtotal: z.number().positive(),
  minimumMeasure: z.number().nonnegative().optional(),
  minimumOrderMeasureExclusive: z.number().nonnegative().optional(),
}).strict().superRefine((r, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  if ((r.quantity.field === null) === (r.quantity.constant === null)) issue('Configura campo o cantidad constante, no ambos.')
  if (r.quantity.min > r.quantity.max || r.minimumSubtotal > r.maximumSubtotal) issue('Límites contradictorios.')
  if (r.quantity.constant !== null && (r.quantity.constant < r.quantity.min || r.quantity.constant > r.quantity.max || (r.quantity.integer && !Number.isInteger(r.quantity.constant)))) issue('Cantidad constante fuera de límites.')
  if (r.saleMode === 'FIXED' && r.quantity.constant !== 1) issue('FIXED requiere cantidad constante 1.')
  if (r.measurements.length !== (r.saleMode === 'AREA' ? 2 : r.saleMode === 'LINEAR' ? 1 : 0)) issue('Esquema de medidas incompatible con modalidad.')
  if (r.saleMode === 'AREA' && r.measurements[0]?.canonicalUnit !== r.measurements[1]?.canonicalUnit) issue('AREA requiere misma unidad canónica en ambos ejes.')
  if (r.saleMode === 'PACKAGE' && !r.variant) issue('PACKAGE requiere variante explícita.')
  const keys = [...r.measurements.flatMap(m => [m.field, m.unitField]), ...r.addOns.map(a => a.field), ...(r.quantity.field ? [r.quantity.field] : []), ...(r.variant ? [r.variant.field] : [])]
  if (new Set(keys).size !== keys.length) issue('Cada entrada comercial requiere un campo independiente.')
  for (const m of r.measurements) {
    if (m.min > m.max) issue('Límites de medida contradictorios.')
    for (const u of m.acceptedUnits) {
      const factor = m.conversionRules[u]
      if (!factor || Math.abs(factor - unitMeters[u] / unitMeters[m.canonicalUnit]) > 1e-10) issue('Conversión de longitud ausente o incorrecta.')
    }
    if (Object.keys(m.conversionRules).some(u => !m.acceptedUnits.includes(u as z.infer<typeof units>))) issue('Conversión para unidad no permitida.')
  }
})
export type CommercialPricing = z.infer<typeof commercialPricingSchema>
const money = z.number().nonnegative().max(100000000)
export const commercialTariffSchema = z.object({
  unitPrice: money, setupPrice: money,
  variants: z.record(z.string(), money), addOns: z.record(z.string(), money),
  taxPercent: z.number().min(0).max(100),
}).strict()

export function resolveCommercialInputs(rule: CommercialPricing, values: Record<string, unknown>) {
  const missing = new Set<string>()
  const q = rule.quantity.field ? values[rule.quantity.field] : rule.quantity.constant
  if (typeof q !== 'number' || !Number.isFinite(q) || q < rule.quantity.min || q > rule.quantity.max ||
    (rule.quantity.integer && !Number.isInteger(q)) || Math.abs(q * 100 - Math.round(q * 100)) > 1e-7) missing.add(rule.quantity.field ?? 'quantity')
  const dimensions = rule.measurements.map(m => {
    const n = values[m.field], u = values[m.unitField]
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) missing.add(m.field)
    if (typeof u !== 'string' || !m.acceptedUnits.includes(u as z.infer<typeof units>)) { missing.add(m.unitField); return 0 }
    const value = typeof n === 'number' && Number.isFinite(n) ? new Prisma.Decimal(n).mul(m.conversionRules[u as z.infer<typeof units>]!).toNumber() : 0
    if (!Number.isFinite(value) || value < m.min || value > m.max) missing.add(m.field)
    return value
  })
  const variant = rule.variant ? values[rule.variant.field] : null
  if (rule.variant && (typeof variant !== 'string' || !rule.variant.options.includes(variant))) missing.add(rule.variant.field)
  const addOns = rule.addOns.filter(a => {
    const value = values[a.field]
    if (value !== undefined && value !== null && typeof value !== 'boolean') missing.add(a.field)
    return value === true
  })
  return missing.size ? { status: 'MISSING_DATA' as const, missingFields: [...missing] } : {
    status: 'READY' as const, input: { quantity: q as number, dimensions, variant: variant as string | null, addOns: addOns.map(a => a.field),
      units: rule.measurements.map(m => m.canonicalUnit), saleMode: rule.saleMode },
  }
}

export function calculateCommercialPrice(rawRule: CommercialPricing, rawTariff: unknown, values: Record<string, unknown>) {
  const rule = commercialPricingSchema.parse(rawRule), tariff = commercialTariffSchema.parse(rawTariff)
  const resolved = resolveCommercialInputs(rule, values)
  if (resolved.status !== 'READY') return resolved
  const input = resolved.input, D = Prisma.Decimal
  if ((rule.variant && rule.variant.options.some(o => !Object.hasOwn(tariff.variants, o))) || rule.addOns.some(a => !Object.hasOwn(tariff.addOns, a.rateKey)))
    return { status: 'RULE_NOT_CONFIGURED' as const, missingFields: [] }
  const measure = input.dimensions.reduce((a, b) => a.mul(b), new D(1))
  if(rule.minimumOrderMeasureExclusive!==undefined&&measure.mul(input.quantity).lte(rule.minimumOrderMeasureExclusive)) return {status:'RULE_NOT_CONFIGURED' as const,missingFields:[]}
  const billableMeasure=D.max(measure,rule.minimumMeasure??0)
  const rate = input.variant === null ? tariff.unitPrice : tariff.variants[input.variant]!
  let perUnit = billableMeasure.mul(rate), setup = new D(tariff.setupPrice)
  for (const a of rule.addOns.filter(a => input.addOns.includes(a.field))) {
    if (a.basis === 'PER_ORDER') setup = setup.plus(tariff.addOns[a.rateKey]!)
    else perUnit = perUnit.plus(tariff.addOns[a.rateKey]!)
  }
  const subtotal = D.max(perUnit.mul(input.quantity).plus(setup), rule.minimumSubtotal).toDecimalPlaces(2, D.ROUND_HALF_UP)
  if (subtotal.gt(rule.maximumSubtotal)) return { status: 'RULE_NOT_CONFIGURED' as const, missingFields: [] }
  const tax = subtotal.mul(tariff.taxPercent).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP)
  const total = subtotal.plus(tax)
  if (!total.isFinite() || total.lte(0) || total.gte(10000000000)) return { status: 'RULE_NOT_CONFIGURED' as const, missingFields: [] }
  return { status: 'READY' as const, input, tariff, calculation: { quantity: input.quantity,
    areaM2: rule.saleMode === 'AREA' ? measure.mul(unitMeters[rule.measurements[0]!.canonicalUnit] ** 2).toDecimalPlaces(4).toNumber() : null,
    unitPrice: subtotal.div(input.quantity).toDecimalPlaces(2, D.ROUND_HALF_UP).toNumber(),
    subtotal: subtotal.toNumber(), discount: 0, tax: tax.toNumber(), total: total.toNumber(),
    components: { measure: measure.toNumber(), rate, perUnit: perUnit.toNumber(), setup: setup.toNumber(), minimumSubtotal: rule.minimumSubtotal } } }
}
