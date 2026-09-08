import { z } from 'zod'

export const contactInputSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Usa el teléfono con código de país.').transform((phone) => phone.replace(/^\+/, '')),
  name: z.string().trim().min(1).max(200).optional(),
  company: z.string().trim().min(1).max(200).optional(),
}).strict()

// Business-critical facts intentionally cannot enter through the preference/memory API.
export const preferencesSchema = z.object({
  preferredChannel: z.enum(['WHATSAPP', 'PHONE', 'EMAIL']).optional(),
  requestsInvoice: z.boolean().optional(),
  consultedProducts: z.array(z.string().max(120)).max(30).optional(),
  interests: z.array(z.string().max(200)).max(20).optional(),
}).strict()

export const createJobSchema = z.object({
  contactProfileId: z.uuid(),
  conversationId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200),
}).strict()

export const createTaskSchema = z.object({
  jobId: z.uuid().optional(),
  conversationId: z.uuid().optional(),
  type: z.enum(['CONFIRM_PAYMENT', 'APPROVE_QUOTE', 'SET_DELIVERY_DATE', 'REQUEST_EARLIER_DELIVERY',
    'VERIFY_ARTWORK', 'CONTACT_CUSTOMER', 'FOLLOW_UP', 'CHECK_REQUIREMENT', 'HANDLE_COMPLAINT',
    'CALL_BACK_CUSTOMER', 'CHECK_PRODUCT_RULE']),
  title: z.string().trim().min(1).max(200),
  dedupeKey: z.string().min(1).max(200),
  details: z.record(z.string(), z.json()).default({}),
  dueAt: z.iso.datetime({ offset: true }).optional(),
}).strict()

export const createApprovalSchema = z.object({
  jobId: z.uuid(),
  type: z.enum(['QUOTE', 'PAYMENT', 'DELIVERY_DATE', 'DISCOUNT', 'SPECIAL_PRICE']),
  dedupeKey: z.string().min(1).max(200),
  payload: z.record(z.string(), z.json()).default({}),
}).strict()

export const summaryInputSchema = z.object({
  conversationId: z.uuid(),
  contactProfileId: z.uuid(),
  text: z.string().trim().min(1).max(4000),
  sourceMessageIds: z.array(z.uuid()).min(1).max(30),
}).strict()
