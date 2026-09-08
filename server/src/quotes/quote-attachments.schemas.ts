import { z } from 'zod'

export const quoteAttachmentFieldsSchema = z.object({
  kind: z.enum(['LOGO', 'REFERENCE', 'INSTALLATION_SPACE']),
  description: z.string().trim().max(500).optional(),
  consent: z.literal('true'),
})

export const allowedQuoteImageTypes = ['image/png', 'image/jpeg', 'image/webp'] as const
