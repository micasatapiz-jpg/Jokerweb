import { z } from 'zod'

export const calculateQuoteSchema = z
  .object({
    productId: z.uuid('Selecciona un producto válido.'),
    quantity: z.coerce.number().positive('La cantidad debe ser mayor que cero.').default(1),
    widthM: z.coerce.number().positive('El ancho debe ser mayor que cero.').optional(),
    heightM: z.coerce.number().positive('El alto debe ser mayor que cero.').optional(),
    installationRequired: z.boolean().default(false),
    includeDesign: z.boolean().default(true),
    includeTransport: z.boolean().default(false),
    discountPercent: z.coerce.number().min(0).max(100).default(0),
  })
  .refine((value) => (!value.widthM && !value.heightM) || (value.widthM && value.heightM), {
    message: 'Ingresa el ancho y el alto juntos.',
    path: ['dimensions'],
  })

export type CalculateQuoteInput = z.infer<typeof calculateQuoteSchema>

export interface PricingRuleSnapshot {
  basePrice: number
  pricePerSquareMeter: number
  designFee: number
  installationFee: number
  transportFee: number
  marginPercent: number
  igvPercent: number
}

export interface PricingResult {
  areaM2: number | null
  quantity: number
  components: {
    base: number
    area: number
    design: number
    installation: number
    transport: number
    margin: number
  }
  unitPrice: number
  subtotal: number
  discount: number
  tax: number
  total: number
}

