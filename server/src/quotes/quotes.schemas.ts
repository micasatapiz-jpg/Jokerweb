import { z } from 'zod'
import { calculateQuoteSchema } from '../pricing/pricing.schemas.js'

export const createQuoteSchema = z.object({
  customerId: z.uuid('Selecciona un cliente válido.'),
  sourceText: z.string().trim().max(6000).optional(),
  notes: z.string().trim().max(2000).optional(),
  designBrief: z.string().trim().max(2000).optional(),
  installationNotes: z.string().trim().max(2000).optional(),
  serviceAddress: z.string().trim().max(500).optional(),
  validDays: z.coerce.number().int().min(1).max(90).default(15),
  items: z.array(calculateQuoteSchema).min(1, 'Agrega al menos un producto.').max(30),
})

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>
