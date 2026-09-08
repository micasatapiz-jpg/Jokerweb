import { z } from 'zod'
import type { CalculateQuoteInput } from '../pricing/pricing.schemas.js'

const field = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/)
const numberBinding = z.discriminatedUnion('source', [
  z.object({ source: z.literal('field'), field, multiplier: z.number().positive().max(1000000).default(1) }).strict(),
  z.object({ source: z.literal('constant'), value: z.number().positive() }).strict(),
])
const booleanBinding = z.discriminatedUnion('source', [
  z.object({ source: z.literal('field'), field }).strict(),
  z.object({ source: z.literal('constant'), value: z.boolean() }).strict(),
])

// Approved data mappings, not executable formulas or guesses about units/services.
export const quoteInputBindingsSchema = z.object({
  quantity: numberBinding,
  widthM: numberBinding.nullable().default(null),
  heightM: numberBinding.nullable().default(null),
  includeDesign: booleanBinding,
  installationRequired: booleanBinding,
  includeTransport: booleanBinding,
}).strict().refine((value) => Boolean(value.widthM) === Boolean(value.heightM), 'Configura ancho y alto juntos.')

export type QuoteInputBindings = z.infer<typeof quoteInputBindingsSchema>

export function resolveQuoteInputs(productId: string, bindings: QuoteInputBindings, values: Record<string, unknown>):
  { status: 'READY'; input: CalculateQuoteInput } | { status: 'MISSING_DATA'; missingFields: string[] } {
  const missing = new Set<string>()
  const numeric = (binding: z.infer<typeof numberBinding>) => {
    const value = binding.source === 'constant' ? binding.value : Object.hasOwn(values, binding.field) ? values[binding.field] : undefined
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      missing.add(binding.source === 'field' ? binding.field : 'configuration'); return 0
    }
    const result = value * (binding.source === 'field' ? binding.multiplier : 1)
    if (!Number.isFinite(result) || result > 1000000) missing.add(binding.source === 'field' ? binding.field : 'configuration')
    return result
  }
  const boolean = (binding: z.infer<typeof booleanBinding>) => {
    const value = binding.source === 'constant' ? binding.value : Object.hasOwn(values, binding.field) ? values[binding.field] : undefined
    if (typeof value !== 'boolean') { missing.add(binding.source === 'field' ? binding.field : 'configuration'); return false }
    return value
  }
  const input: CalculateQuoteInput = { productId, quantity: numeric(bindings.quantity),
    widthM: bindings.widthM ? numeric(bindings.widthM) : undefined, heightM: bindings.heightM ? numeric(bindings.heightM) : undefined,
    includeDesign: boolean(bindings.includeDesign), installationRequired: boolean(bindings.installationRequired),
    includeTransport: boolean(bindings.includeTransport), discountPercent: 0 }
  for (const target of ['quantity', 'widthM', 'heightM'] as const) {
    const value = input[target]
    if (value === undefined) continue
    const scale = target === 'quantity' ? 100 : 1000
    if (value < 1 / scale || Math.abs(value - Math.round(value * scale) / scale) > 1e-9) {
      const binding = bindings[target]
      missing.add(binding?.source === 'field' ? binding.field : 'configuration')
    }
  }
  // Discounts are deliberately not accepted from conversational requirements.
  return missing.size ? { status: 'MISSING_DATA', missingFields: [...missing] } : { status: 'READY', input }
}
