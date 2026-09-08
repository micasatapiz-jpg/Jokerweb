import { z } from 'zod'
import type { JobStatus, TaskType } from '../generated/prisma/client.js'

export const actorSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(['OWNER', 'ADMIN', 'SALES', 'CUSTOMER', 'SYSTEM']),
  contactProfileId: z.uuid().optional(),
}).strict()
// Actors are supplied by authenticated adapters, never directly by an LLM/tool argument.
export type TrustedActor = z.infer<typeof actorSchema>

export const jobEventSchema = z.object({
  eventKey: z.string().min(1).max(200),
  type: z.enum(['START_CONSULTATION', 'COLLECT_DATA', 'REQUIREMENTS_READY', 'NEEDS_REVIEW',
    'QUOTE_ISSUED', 'CUSTOMER_ACCEPTED', 'DEPOSIT_REQUESTED', 'PAYMENT_REPORTED',
    'PAYMENT_CONFIRMED', 'START_PRODUCTION', 'REQUEST_EARLIER_DELIVERY', 'SET_DELIVERY_DATE',
    'DATE_ELAPSED', 'READY_FOR_PICKUP', 'DELIVERY_CONFIRMED', 'REQUEST_HUMAN',
    'COMPLAINT', 'REQUIREMENTS_CHANGED', 'ARTWORK_APPROVED', 'PAUSE', 'CANCEL']),
  evidence: z.string().trim().min(1).max(4000),
  readyAt: z.iso.datetime({ offset: true }).optional(),
  approvalId: z.uuid().optional(),
  quoteId: z.uuid().optional(),
  amount: z.number().positive().max(10000000).optional(),
}).strict()
export type JobEventInput = z.infer<typeof jobEventSchema>

type StateResult = { status: JobStatus; task?: TaskType; readyAt?: Date; delivered?: boolean; artworkApproved?: boolean }
const staff = ['OWNER', 'ADMIN', 'SALES']
const owner = ['OWNER']
const human = [...staff, 'CUSTOMER']

export function transitionJob(current: JobStatus, event: JobEventInput, actor: TrustedActor): StateResult {
  jobEventSchema.parse(event)
  actorSchema.parse(actor)
  const allow = (roles: string[]) => {
    if (!roles.includes(actor.role)) throw new Error('Actor no autorizado para este evento.')
  }
  const from = (...states: JobStatus[]) => {
    if (!states.includes(current)) throw new Error(`Transición no permitida desde ${current}.`)
  }
  // A date passing is not evidence of delivery, regardless of the current status.
  if (event.type === 'DATE_ELAPSED') return { status: current }
  if (event.type === 'REQUEST_HUMAN') {
    allow(human)
    return { status: ['ENTREGADO', 'CANCELADO'].includes(current) ? current : 'REQUIERE_HUMANO', task: 'CONTACT_CUSTOMER' }
  }
  if (event.type === 'COMPLAINT') {
    allow(human)
    return { status: current, task: 'HANDLE_COMPLAINT' }
  }
  if (['ENTREGADO', 'CANCELADO'].includes(current)) throw new Error('El trabajo está cerrado; registra una tarea o crea otro trabajo.')
  switch (event.type) {
    case 'START_CONSULTATION': allow([...human, 'SYSTEM']); from('NUEVO'); return { status: 'CONSULTANDO' }
    case 'COLLECT_DATA': allow([...human, 'SYSTEM']); from('NUEVO', 'CONSULTANDO', 'RECOPILANDO_DATOS'); return { status: 'RECOPILANDO_DATOS' }
    case 'REQUIREMENTS_READY': allow([...staff, 'SYSTEM']); from('CONSULTANDO', 'RECOPILANDO_DATOS', 'REQUIERE_REVISION'); return { status: 'LISTO_PARA_COTIZAR' }
    case 'NEEDS_REVIEW': allow([...staff, 'SYSTEM']); return { status: 'REQUIERE_REVISION', task: 'CHECK_REQUIREMENT' }
    case 'QUOTE_ISSUED':
      allow(staff); from('LISTO_PARA_COTIZAR', 'REQUIERE_REVISION');
      if (!event.quoteId) throw new Error('Falta una cotización confirmada.')
      return { status: 'COTIZADO' }
    case 'CUSTOMER_ACCEPTED': allow(human); from('COTIZADO', 'ESPERANDO_CLIENTE'); return { status: 'ACEPTADO' }
    case 'DEPOSIT_REQUESTED': allow([...staff, 'SYSTEM']); from('ACEPTADO'); return { status: 'ESPERANDO_ADELANTO' }
    case 'PAYMENT_REPORTED':
      allow(human); from('ACEPTADO', 'ESPERANDO_ADELANTO', 'PAGO_POR_CONFIRMAR');
      return { status: 'PAGO_POR_CONFIRMAR', task: 'CONFIRM_PAYMENT' }
    case 'PAYMENT_CONFIRMED':
      allow(owner); from('PAGO_POR_CONFIRMAR');
      if (!event.approvalId) throw new Error('Falta aprobación del pago.')
      return { status: 'PAGO_CONFIRMADO' }
    case 'START_PRODUCTION': allow(staff); from('PAGO_CONFIRMADO'); return { status: 'EN_PRODUCCION' }
    case 'REQUEST_EARLIER_DELIVERY': allow(human); return { status: current, task: 'REQUEST_EARLIER_DELIVERY' }
    case 'SET_DELIVERY_DATE':
      allow(owner)
      if (!event.readyAt || !event.approvalId) throw new Error('Falta fecha explícita y aprobación.')
      return { status: current, readyAt: new Date(event.readyAt) }
    case 'READY_FOR_PICKUP': allow(staff); from('EN_PRODUCCION', 'FECHA_PENDIENTE'); return { status: 'LISTO_PARA_RECOGER' }
    case 'DELIVERY_CONFIRMED': allow(human); from('LISTO_PARA_RECOGER', 'EN_PRODUCCION'); return { status: 'ENTREGADO', delivered: true }
    case 'REQUIREMENTS_CHANGED': allow(human); return { status: 'REQUIERE_REVISION', task: 'CHECK_REQUIREMENT' }
    case 'ARTWORK_APPROVED': allow(human); return { status: current, artworkApproved: true }
    case 'PAUSE': allow(human); return { status: 'PAUSADO' }
    case 'CANCEL': allow(human); return { status: 'CANCELADO' }
  }
}
