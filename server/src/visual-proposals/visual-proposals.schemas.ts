import { z } from 'zod'

export const allowedImageTypes = ['image/png', 'image/jpeg', 'image/webp'] as const

export const createProposalFieldsSchema = z.object({
  description: z.string().trim().min(10).max(1500),
  openaiConsent: z.literal('true'),
})

export const generateProposalFieldsSchema = z.object({
  mode: z.enum(['NEUTRAL', 'CONTEXTUAL']),
  spacePhotoConsent: z.enum(['true', 'false']),
  notes: z.string().trim().max(800).optional(),
}).superRefine((value, context) => {
  if (value.mode === 'CONTEXTUAL' && value.spacePhotoConsent !== 'true') {
    context.addIssue({ code: 'custom', path: ['spacePhotoConsent'], message: 'La foto del local requiere aceptación explícita.' })
  }
  if (value.mode === 'NEUTRAL' && value.spacePhotoConsent !== 'false') {
    context.addIssue({ code: 'custom', path: ['spacePhotoConsent'], message: 'El fondo neutro no necesita permiso para una foto del local.' })
  }
})

export type LogoAnalysis = {
  summary: string
  colors: string[]
  recommendedSign: string
  designNotes: string[]
  questions: string[]
}
