import { z } from 'zod'

const optionalText = z.string().trim().min(1).max(250).optional()

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Ingresa el nombre del cliente.').max(150),
  phone: optionalText,
  email: z.email('Ingresa un correo válido.').optional(),
  company: optionalText,
  district: optionalText,
  notes: z.string().trim().max(1000).optional(),
})

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>

