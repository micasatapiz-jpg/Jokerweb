import { describe, expect, it } from 'vitest'
import { transitionJob, type JobEventInput, type TrustedActor } from './job-state.js'
import { preferencesSchema } from './commercial.schemas.js'

const owner: TrustedActor = { id: 'owner-verified', role: 'OWNER' }
const customer: TrustedActor = { id: 'customer-verified', role: 'CUSTOMER' }
const system: TrustedActor = { id: 'agent', role: 'SYSTEM' }
const event = (type: JobEventInput['type'], extra = {}): JobEventInput => ({ eventKey: 'message-1', type, evidence: 'Mensaje explícito y confirmado', ...extra })

describe('Job: hechos, peticiones y decisiones', () => {
  it('aceptar nunca inicia producción', () => {
    expect(transitionJob('COTIZADO', event('CUSTOMER_ACCEPTED'), customer).status).toBe('ACEPTADO')
    expect(() => transitionJob('ACEPTADO', event('START_PRODUCTION'), owner)).toThrow()
  })
  it('un comprobante deja el pago por confirmar', () => {
    expect(transitionJob('ESPERANDO_ADELANTO', event('PAYMENT_REPORTED'), customer)).toEqual({ status: 'PAGO_POR_CONFIRMAR', task: 'CONFIRM_PAYMENT' })
  })
  it('solo el dueño puede confirmar, con aprobación identificada', () => {
    const input = event('PAYMENT_CONFIRMED', { approvalId: '11111111-1111-4111-8111-111111111111' })
    for (const actor of [customer, system, { id: 'sales', role: 'SALES' as const }]) {
      expect(() => transitionJob('PAGO_POR_CONFIRMAR', input, actor)).toThrow('Actor no autorizado')
    }
    expect(transitionJob('PAGO_POR_CONFIRMAR', input, owner).status).toBe('PAGO_CONFIRMADO')
    expect(() => transitionJob('PAGO_POR_CONFIRMAR', event('PAYMENT_CONFIRMED'), owner)).toThrow('aprobación')
  })
  it('adelantar crea tarea pero no cambia fecha ni estado', () => {
    expect(transitionJob('EN_PRODUCCION', event('REQUEST_EARLIER_DELIVERY'), customer)).toEqual({ status: 'EN_PRODUCCION', task: 'REQUEST_EARLIER_DELIVERY' })
  })
  it('la fecha requiere dueño y aprobación, no inicia ni termina producción', () => {
    const input = event('SET_DELIVERY_DATE', { readyAt: '2026-09-20T15:00:00-05:00', approvalId: '11111111-1111-4111-8111-111111111111' })
    expect(() => transitionJob('EN_PRODUCCION', input, customer)).toThrow()
    expect(transitionJob('EN_PRODUCCION', input, owner)).toEqual({ status: 'EN_PRODUCCION', readyAt: new Date(input.readyAt!) })
  })
  it.each(['EN_PRODUCCION', 'LISTO_PARA_RECOGER', 'ENTREGADO'] as const)('el tiempo no cambia %s', (state) => {
    expect(transitionJob(state, event('DATE_ELAPSED'), system)).toEqual({ status: state })
  })
  it('entrega requiere una confirmación humana y evidencia', () => {
    expect(transitionJob('LISTO_PARA_RECOGER', event('DELIVERY_CONFIRMED'), owner)).toEqual({ status: 'ENTREGADO', delivered: true })
    expect(() => transitionJob('LISTO_PARA_RECOGER', event('DELIVERY_CONFIRMED'), system)).toThrow()
    expect(() => transitionJob('LISTO_PARA_RECOGER', event('DELIVERY_CONFIRMED', { evidence: '' }), owner)).toThrow()
  })
  it('deriva a humano sin retener al cliente', () => {
    expect(transitionJob('RECOPILANDO_DATOS', event('REQUEST_HUMAN'), customer)).toEqual({ status: 'REQUIERE_HUMANO', task: 'CONTACT_CUSTOMER' })
  })
  it('un reclamo posterior no reabre ni pierde la entrega registrada', () => {
    expect(transitionJob('ENTREGADO', event('COMPLAINT'), customer)).toEqual({ status: 'ENTREGADO', task: 'HANDLE_COMPLAINT' })
    expect(() => transitionJob('ENTREGADO', event('REQUIREMENTS_CHANGED'), customer)).toThrow('cerrado')
  })
  it('cambiar material, medidas o archivo exige revisión', () => {
    expect(transitionJob('ACEPTADO', event('REQUIREMENTS_CHANGED'), customer)).toEqual({ status: 'REQUIERE_REVISION', task: 'CHECK_REQUIREMENT' })
  })
  it('la memoria admite preferencias pero no precios, pagos ni fechas', () => {
    expect(preferencesSchema.parse({ requestsInvoice: true })).toEqual({ requestsInvoice: true })
    for (const key of ['price', 'paymentConfirmed', 'confirmedReadyAt', 'discount']) expect(() => preferencesSchema.parse({ [key]: 10 })).toThrow()
  })
})
