import { z } from 'zod'

export const simulateWhatsAppSchema = z.object({
  from: z.string().trim().min(6).max(30),
  name: z.string().trim().min(1).max(120).optional(),
  messages: z.array(z.object({
    type: z.enum(['text', 'image', 'audio', 'document']).default('text'),
    text: z.string().trim().max(6000).optional(),
    mediaId: z.string().trim().max(500).optional(),
    mimeType: z.string().trim().max(120).optional(),
    fileName: z.string().trim().max(255).optional(),
  })).min(1).max(20),
})

export type SimulateWhatsAppInput = z.infer<typeof simulateWhatsAppSchema>

export interface MetaWebhookMessage {
  id: string
  from: string
  timestamp?: string
  type: 'text' | 'image' | 'audio' | 'document' | string
  text?: { body?: string }
  image?: { id?: string; mime_type?: string; caption?: string }
  audio?: { id?: string; mime_type?: string }
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string }
}

export interface MetaWebhookPayload {
  object?: string
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
        messages?: MetaWebhookMessage[]
      }
    }>
  }>
}
