import { z } from 'zod'

const nonNegativeMoney = z.coerce.number().finite().min(0, 'El importe no puede ser negativo.').max(1_000_000)

export const updatePriceRuleSchema = z.object({
  name: z.string().trim().min(3).max(100).default('Tarifa comercial'),
  basePrice: nonNegativeMoney,
  pricePerSquareMeter: nonNegativeMoney,
  designFee: nonNegativeMoney,
  installationFee: nonNegativeMoney,
  transportFee: nonNegativeMoney,
  marginPercent: z.coerce.number().finite().min(0).max(500),
  igvPercent: z.coerce.number().finite().min(0).max(100).default(18),
})

export type UpdatePriceRuleInput = z.infer<typeof updatePriceRuleSchema>
