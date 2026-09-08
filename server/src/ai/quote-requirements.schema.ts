import { z } from 'zod'

export const quoteRequirementsSchema = z.object({
  productType: z.string().min(1).nullable(),
  widthM: z.number().positive().nullable(),
  heightM: z.number().positive().nullable(),
  quantity: z.number().positive().nullable(),
  material: z.string().min(1).nullable(),
  installationRequired: z.boolean().nullable(),
  location: z.string().min(1).nullable(),
  requestedDate: z.string().min(1).nullable(),
  notes: z.array(z.string()),
  missingFields: z.array(z.string()),
  confidence: z.number().min(0).max(1),
})

export type QuoteRequirements = z.infer<typeof quoteRequirementsSchema>

export const analyzeRequestSchema = z.object({
  message: z.string().trim().min(10, 'Describe con más detalle lo que necesita el cliente.').max(6000),
})

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>

export const quoteRequirementsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'productType',
    'widthM',
    'heightM',
    'quantity',
    'material',
    'installationRequired',
    'location',
    'requestedDate',
    'notes',
    'missingFields',
    'confidence',
  ],
  properties: {
    productType: { type: ['string', 'null'] },
    widthM: { type: ['number', 'null'], exclusiveMinimum: 0 },
    heightM: { type: ['number', 'null'], exclusiveMinimum: 0 },
    quantity: { type: ['number', 'null'], exclusiveMinimum: 0 },
    material: { type: ['string', 'null'] },
    installationRequired: { type: ['boolean', 'null'] },
    location: { type: ['string', 'null'] },
    requestedDate: { type: ['string', 'null'] },
    notes: { type: 'array', items: { type: 'string' } },
    missingFields: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const

