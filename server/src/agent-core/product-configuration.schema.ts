import { z } from 'zod'
import { quoteInputBindingsSchema } from './quote-inputs.js'

const keySchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/).refine((s) => !['constructor', 'prototype', '__proto__'].includes(s))
const text = z.string().trim().min(1).max(500)
const fieldRule = z.object({
  question: text,
  type: z.enum(['text', 'number', 'boolean', 'choice']),
  min: z.number().optional(), max: z.number().optional(),
  choices: z.array(text).max(30).optional(),
}).strict().superRefine((rule, ctx) => {
  if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) ctx.addIssue({ code: 'custom', message: 'El mínimo supera al máximo.' })
  if (rule.type === 'choice' && !rule.choices?.length) ctx.addIssue({ code: 'custom', message: 'Faltan las opciones permitidas.' })
})

const format = z.string().regex(/^[A-Za-z0-9]{2,12}$/).transform((s) => s.toUpperCase())

export const productConfigurationSchema = z.object({
  quotationRules: z.object({
    requiredFields: z.array(keySchema).max(40).default([]),
    optionalFields: z.array(keySchema).max(40).default([]),
    fields: z.record(keySchema, fieldRule).default({}),
    technicalRequirements: z.array(text).max(30).default([]),
    materials: z.array(text).max(30).default([]),
    finishes: z.array(text).max(30).default([]),
    requiresDesign: z.boolean().nullable().default(null),
    pricingEngine: z.enum(['STANDARD_AREA_V1']).nullable().default(null),
    pricingInputs: quoteInputBindingsSchema.nullable().default(null),
    validityDays: z.number().int().min(1).max(90).nullable().default(null),
  }).strict(),
  fileRules: z.object({
    preferredFormats: z.array(format).max(20).default([]),
    allowedFormats: z.array(format).max(20).default([]),
    preferOriginalFile: z.boolean().default(false),
    acceptOriginalFile: z.boolean().default(true),
    sendAsDocument: z.boolean().default(false),
    requiresFinalArtwork: z.boolean().default(false),
    minDpi: z.number().positive().nullable().default(null),
    minWidthPx: z.number().int().positive().nullable().default(null),
    minHeightPx: z.number().int().positive().nullable().default(null),
    maxSizeBytes: z.number().int().positive().nullable().default(null),
    aspectRatioTolerance: z.number().min(0).max(1).nullable().default(null),
  }).strict().default({ preferredFormats: [], allowedFormats: [], preferOriginalFile: false, acceptOriginalFile: true,
    sendAsDocument: false, requiresFinalArtwork: false, minDpi: null, minWidthPx: null, minHeightPx: null, maxSizeBytes: null, aspectRatioTolerance: null }),
  productionRules: z.object({
    configured: z.boolean().default(false),
    requiresPaymentConfirmation: z.boolean().default(true),
    requiresArtworkApproval: z.boolean().default(true),
    automaticProductionStart: z.literal(false).default(false),
    technicalRequirements: z.array(text).max(30).default([]),
  }).strict().default({ configured: false, requiresPaymentConfirmation: true, requiresArtworkApproval: true, automaticProductionStart: false, technicalRequirements: [] }),
  deliveryRules: z.object({
    standardLeadTimeHours: z.number().positive().nullable().default(null),
    requiresOwnerDateConfirmation: z.boolean().default(true),
    instructions: z.array(text).max(20).default([]),
  }).strict().default({ standardLeadTimeHours: null, requiresOwnerDateConfirmation: true, instructions: [] }),
  installationRules: z.object({
    requiresInstallation: z.boolean().nullable().default(null),
    requiresLocation: z.boolean().default(false),
    offerSpacePhoto: z.boolean().default(false),
    restrictions: z.array(text).max(30).default([]),
  }).strict().default({ requiresInstallation: null, requiresLocation: false, offerSpacePhoto: false, restrictions: [] }),
  autoQuoteEnabled: z.boolean().default(false),
  requiresHumanReview: z.boolean().default(true),
}).strict().superRefine((rules, ctx) => {
  const required = rules.quotationRules.requiredFields
  const optional = rules.quotationRules.optionalFields
  if (new Set([...required, ...optional]).size !== required.length + optional.length) ctx.addIssue({ code: 'custom', message: 'Los campos requeridos y opcionales no deben repetirse.' })
  for (const key of [...required, ...optional]) {
    if (!rules.quotationRules.fields[key]) ctx.addIssue({ code: 'custom', message: `Falta definir tipo y pregunta de ${key}.` })
  }
  for (const [target, binding] of Object.entries(rules.quotationRules.pricingInputs ?? {})) {
    if (binding?.source !== 'field') continue
    const expected = ['quantity', 'widthM', 'heightM'].includes(target) ? 'number' : 'boolean'
    if (rules.quotationRules.fields[binding.field]?.type !== expected) ctx.addIssue({ code: 'custom', message: `El cálculo requiere el campo ${binding.field} de tipo ${expected}.` })
  }
  if (rules.autoQuoteEnabled && !rules.quotationRules.pricingEngine) ctx.addIssue({ code: 'custom', message: 'Selecciona un motor de precio validado antes de habilitar cotización automática.' })
  if (rules.autoQuoteEnabled && rules.requiresHumanReview) ctx.addIssue({ code: 'custom', message: 'Una cotización automática no puede requerir revisión humana simultáneamente.' })
})

export type ProductConfigurationRules = z.infer<typeof productConfigurationSchema>

export function evaluateProductRules(rules: ProductConfigurationRules | null, values: Record<string, unknown>) {
  if (!rules) return { status: 'RULE_NOT_CONFIGURED' as const, missingFields: [] as string[], questions: [] as string[] }
  const missingFields: string[] = []
  const questions: string[] = []
  for (const [key, field] of Object.entries(rules.quotationRules.fields)) {
    const value = Object.hasOwn(values, key) ? values[key] : undefined
    const empty = value === undefined || value === null || (typeof value === 'string' && !value.trim())
    const required = rules.quotationRules.requiredFields.includes(key)
    if (empty && !required) continue
    let valid = !empty
    if (valid) {
      if (field.type === 'number') valid = typeof value === 'number' && Number.isFinite(value) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max)
      if (field.type === 'boolean') valid = typeof value === 'boolean'
      if (field.type === 'text') valid = typeof value === 'string' && value.length <= 4000
      if (field.type === 'choice') valid = typeof value === 'string' && Boolean(field.choices?.includes(value))
    }
    if (!valid) { missingFields.push(key); questions.push(field.question) }
  }
  if (rules.installationRules.requiresLocation && !values.location) {
    if (!missingFields.includes('location')) { missingFields.push('location'); questions.push('¿En qué dirección o distrito se instalará?') }
  }
  return { status: missingFields.length ? 'MISSING_DATA' as const : rules.requiresHumanReview || !rules.autoQuoteEnabled ? 'HUMAN_REVIEW' as const : 'READY' as const,
    missingFields, questions: questions.slice(0, 2) }
}
