import { z } from 'zod'
import type { ActorIdentity, Conversation } from '../generated/prisma/client.js'

export const permissionSchema = z.enum(['VIEW_JOBS', 'CREATE_JOB', 'UPDATE_JOB', 'UPDATE_REQUIREMENTS', 'CREATE_QUOTE', 'VIEW_QUOTES', 'SEND_QUOTE',
  'CREATE_DOCUMENT', 'VIEW_INTERNAL_FINANCE', 'REGISTER_PAYMENT_REPORT', 'CONFIRM_PAYMENT', 'APPROVE_QUOTE', 'APPROVE_SPECIAL_PRICE',
  'CHANGE_PRODUCT_RULE', 'MANAGE_EMPLOYEES', 'MANAGE_PERMISSIONS', 'CHANGE_AUTOMATION_MODE', 'MANAGE_TAGS', 'MANAGE_INTERNAL_CONVERSATIONS'])
export type Permission = z.infer<typeof permissionSchema>
export function hasPermission(actor: Pick<ActorIdentity, 'type' | 'active' | 'permissions'> | null, permission: Permission) {
  return Boolean(actor?.active && (actor.type === 'OWNER' || (actor.type === 'EMPLOYEE' && actor.permissions.includes(permission))))
}
export function normalizeActorPhone(value: string) {
  let phone = value.replace(/[\s()+-]/g, '')
  if (/^9\d{8}$/.test(phone)) phone = `51${phone}`
  return z.string().regex(/^[1-9]\d{7,14}$/).parse(phone)
}
export function maySendAutomatically(conversation: Pick<Conversation, 'automationMode' | 'role'>, internalReply = false) {
  const mode = conversation.automationMode ?? 'AUTO' // Existing test fixtures / pre-migration contracts.
  if (mode === 'PAUSED' || mode === 'HUMAN_TAKEOVER') return false
  if (conversation.role === 'INTERNAL_TEAM') return internalReply
  return mode === 'AUTO' || (mode === 'ASSIST' && internalReply && conversation.role === 'OWNER_PRIVATE')
}

export function classifySecurity(text: string, internalActor: boolean) {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (!internalActor && /soy (joel|el dueno|el propietario)/.test(t)) return { reason: 'OWNER_IMPERSONATION', risk: 90, recommendation: 'IGNORE' }
  if (/ignora (tus|las) reglas|muestrame informacion interna|dame los datos internos|revela.*(clave|token)/.test(t)) return { reason: 'PROMPT_INJECTION_ATTEMPT', risk: 90, recommendation: 'IGNORE' }
  if (!internalActor && /confirma.*pago|cambia.*precio|dame.*(contrasena|acceso)/.test(t)) return { reason: 'SOCIAL_ENGINEERING_ATTEMPT', risk: 85, recommendation: 'IGNORE' }
  if (/https?:\/\/\S+.*(?:premio|ganaste)|compra seguidores/.test(t)) return { reason:'SPAM_SUSPECTED',risk:60,recommendation:'IGNORE' }
  if (/te voy a matar|voy a quemar tu/.test(t)) return { reason:'ABUSIVE_CONTACT',risk:90,recommendation:'BLOCK' }
  if (/<script|javascript:|\bexe\b.*descarga/.test(t)) return { reason:'SUSPICIOUS_CONTENT',risk:70,recommendation:'IGNORE' }
  if (!internalActor && /joker.*(trabajos pendientes|trabajos tenemos|registra.*pedido|revisar produccion)/.test(t)) return { reason: 'UNAUTHORIZED_INTERNAL_REQUEST', risk: 40, recommendation: 'CONFIRM_EMPLOYEE' }
  if (/futbol|partido|clima|noticias/.test(t)) return { reason: 'OUT_OF_SCOPE', risk: 0, recommendation: 'KEEP_ACTIVE' }
  return { reason: 'IN_SCOPE', risk: 0, recommendation: 'KEEP_ACTIVE' }
}
