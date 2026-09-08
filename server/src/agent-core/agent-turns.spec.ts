import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AgentTurnsService, assertTurnLease } from './agent-turns.service.js'
import { AgentOutboxService, outboxDisposition } from './agent-outbox.service.js'
import { transactionScope } from './transaction-scope.js'

// Contract fixture, not a PostgreSQL emulator. The integration suite separately verifies
// real locks, constraints, JSONB round trips and rollback of tool effects plus receipts.
function harness() {
  const tenantId = randomUUID(), conversationId = randomUUID(), messageId = randomUUID()
  let state: any = { conversation: { id: conversationId, status: 'COLLECTING', customerPhone: '51999000123', customerName: 'Cliente fixture',
    externalId: '51999000123', lastInboundAt: new Date(Date.now() - 30000) },
    contact: { id: randomUUID(), phone: '51999000123', name: 'Cliente fixture', preferences: {} },
    turn: null, jobs: [], calls: [], outbox: [], tasks: [], outbound: [], messages: [{ id: messageId, text: 'Quiero un letrero', type: 'TEXT', status: 'BUFFERED' }] }
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    conversation: { findFirst: vi.fn(async () => state.conversation), findFirstOrThrow: vi.fn(async () => state.conversation), update: vi.fn(async ({ data }: any) => Object.assign(state.conversation, data)) },
    conversationMessage: { findMany: vi.fn(async () => state.messages.filter((message: any) => message.status === 'BUFFERED')),
      updateMany: vi.fn(async ({ data }: any) => { state.messages.forEach((message: any) => Object.assign(message, data)); return { count: state.messages.length } }),
      findUnique: vi.fn(async ({ where }: any) => state.outbound.find((message: any) => message.externalMessageId === where.conversationId_externalMessageId.externalMessageId) ?? null),
      upsert: vi.fn(async ({ create }: any) => { state.outbound.push(create); return create }) },
    agentTurn: {
      findFirst: vi.fn(async () => state.turn), findFirstOrThrow: vi.fn(async () => state.turn),
      create: vi.fn(async ({ data }: any) => { state.turn = { ...data, id: randomUUID(), status: 'IN_PROGRESS', attempts: 1, plan: null, result: null }; return state.turn }),
      update: vi.fn(async ({ data }: any) => { const attempts = state.turn.attempts; Object.assign(state.turn, data); if (data.attempts?.increment) state.turn.attempts = attempts + data.attempts.increment; return state.turn }),
    },
    agentTurnMessage: { createMany: vi.fn(async () => ({ count: 1 })) },
    agentToolCall: { findUnique: vi.fn(async ({ where }: any) => state.calls.find((call: any) => call.callId === where.tenantId_turnId_callId.callId) ?? null),
      create: vi.fn(async ({ data }: any) => { state.calls.push(data); return data }) },
    contactProfile: { upsert: vi.fn(async () => state.contact) },
    job: { findUnique: vi.fn(async ({ where }: any) => state.jobs.find((job: any) => job.originKey === where.tenantId_originKey.originKey) ?? null),
      create: vi.fn(async ({ data }: any) => { const job = { ...data, id: randomUUID(), requirementsRevision: 0 }; state.jobs.push(job); return job }) },
    agentOutbox: {
      create: vi.fn(async ({ data }: any) => { const row = { ...data, id: randomUUID(), status: 'PENDING', leaseOwner: null, leaseUntil: null }; state.outbox.push(row); return row }),
      findFirst: vi.fn(async ({ where }: any) => (where.id ? state.outbox.find((row: any) => row.id === where.id) : state.outbox.find((row: any) => !['SENT', 'CANCELLED'].includes(row.status))) ?? null),
      findFirstOrThrow: vi.fn(async ({ where }: any) => state.outbox.find((row: any) => row.id === where.id)),
      update: vi.fn(async ({ where, data }: any) => Object.assign(state.outbox.find((row: any) => row.id === where.id), data)),
    },
    task: { upsert: vi.fn(async ({ create }: any) => { const prior = state.tasks.find((task: any) => task.dedupeKey === create.dedupeKey); if (prior) return prior; state.tasks.push(create); return create }), updateMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: { create: vi.fn(async () => ({})) },
  }
  const db: any = { $transaction: vi.fn(async (callback: any) => { const before = structuredClone(state); try { return await callback(tx) } catch (error) { state = before; throw error } }) }
  const tenant: any = { tenantId }
  const turns = new AgentTurnsService(db, tenant), outbox = new AgentOutboxService(db, tenant)
  const claim = async () => { const result = await turns.claimNext(conversationId); if (result.status !== 'CLAIMED') throw new Error(result.status); return result.handle }
  const queued = async () => { const handle = await claim(); await turns.complete(handle, 'Respuesta fixture'); const result = await outbox.claimNext(conversationId); if (result.status !== 'CLAIMED') throw new Error(result.status); return result.handle }
  return { turns, outbox, tx, db, conversationId, messageId, state: () => state, claim, queued }
}

describe('Turnos durables: reservas y recibos de herramientas', () => {
  it('solo reclama mensajes después de la pausa y registra pertenencia exclusiva', async () => {
    const h = harness(); h.state().conversation.lastInboundAt = new Date()
    expect((await h.turns.claimNext(h.conversationId)).status).toBe('WAITING')
    h.state().conversation.lastInboundAt = new Date(Date.now() - 30000)
    await h.claim()
    expect(h.tx.agentTurnMessage.createMany).toHaveBeenCalledOnce()
    expect(h.tx.conversationMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ direction: 'INBOUND', status: 'BUFFERED', turnMemberships: { none: {} } }), take: 30 }))
  })
  it('otra réplica no reclama la reserva viva y una reserva expirada cambia de propietario', async () => {
    const h = harness(), first = await h.claim()
    expect((await h.turns.claimNext(h.conversationId)).status).toBe('BUSY')
    h.state().turn.leaseUntil = new Date(0)
    const recovered = await h.turns.claimNext(h.conversationId)
    expect(recovered.status).toBe('CLAIMED')
    if (recovered.status === 'CLAIMED') expect(recovered.handle.leaseOwner).not.toBe(first.leaseOwner)
    await expect(h.turns.savePlan(first, { old: true })).rejects.toThrow('reserva')
  })
  it('no acepta un propietario equivocado, una reserva expirada ni un turno terminado', () => {
    const leaseOwner = randomUUID(), handle = { turnId: randomUUID(), leaseOwner }
    expect(() => assertTurnLease({ status: 'IN_PROGRESS', leaseOwner, leaseUntil: new Date(0) }, handle)).toThrow()
    expect(() => assertTurnLease({ status: 'COMPLETED', leaseOwner, leaseUntil: new Date(Date.now() + 90000) }, handle)).toThrow()
    expect(() => assertTurnLease({ status: 'IN_PROGRESS', leaseOwner: randomUUID(), leaseUntil: new Date(Date.now() + 90000) }, handle)).toThrow()
  })
  it('conserva un plan fijo para reanudar y rechaza reemplazarlo silenciosamente', async () => {
    const h = harness(), handle = await h.claim()
    await h.turns.savePlan(handle, { expectedRevision: 0, product: 'fixture' })
    expect(await h.turns.savePlan(handle, { product: 'fixture', expectedRevision: 0 })).toEqual({ product: 'fixture', expectedRevision: 0 })
    await expect(h.turns.savePlan(handle, { expectedRevision: 1 })).rejects.toThrow('plan persistido')
  })
  it('no repite una operación ya recibida y rechaza cambiar sus argumentos', async () => {
    const h = harness(), handle = await h.claim(), tool = { name: 'createJob', args: { title: 'Pedido fixture' } }
    const first = await h.turns.runCustomerTool(handle, 'job-0', tool)
    expect(await h.turns.runCustomerTool(handle, 'job-0', tool)).toEqual(first)
    expect(h.state().jobs).toHaveLength(1)
    expect(h.state().calls).toHaveLength(1)
    await expect(h.turns.runCustomerTool(handle, 'job-0', { ...tool, args: { title: 'Otro pedido' } })).rejects.toThrow('otros argumentos')
  })
  it('la escritura de efecto y recibo utiliza la misma transacción exterior', async () => {
    const h = harness(), handle = await h.claim()
    h.tx.agentToolCall.create.mockRejectedValueOnce(new Error('Fallo al guardar recibo'))
    await expect(h.turns.runCustomerTool(handle, 'job-0', { name: 'createJob', args: { title: 'Pedido fixture' } })).rejects.toThrow('recibo')
    expect(h.state().jobs).toHaveLength(0)
    expect(h.state().calls).toHaveLength(0)
    await h.turns.runCustomerTool(handle, 'job-0', { name: 'createJob', args: { title: 'Pedido fixture' } })
    expect(h.state().jobs).toHaveLength(1)
  })
  it('terminar encola la respuesta y procesa únicamente los mensajes del turno', async () => {
    const h = harness(), handle = await h.claim()
    await h.turns.complete(handle, 'Respuesta fixture')
    expect(h.state().turn.status).toBe('COMPLETED')
    expect(h.state().outbox[0].status).toBe('PENDING')
    expect(h.tx.conversationMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: [h.messageId] } }) }))
  })
  it('handoff impide continuar vendiendo y solo encola un acuse controlado', async () => {
    const h = harness(), handle = await h.claim(); h.state().conversation.status = 'HANDOFF'
    await h.turns.complete(handle, 'Texto que no debe enviar el agente')
    expect(h.state().outbox[0].payload).toEqual({ text: 'Claro, tu consulta queda pendiente de atención del encargado.', handoffAcknowledgement: true })
  })
  it('limita recuperaciones y deja tarea sin inventar una respuesta comercial', async () => {
    const h = harness(); await h.claim(); h.state().turn.attempts = 3; h.state().turn.leaseUntil = new Date(0)
    expect((await h.turns.claimNext(h.conversationId)).status).toBe('REQUIRES_REVIEW')
    expect(h.state().tasks).toHaveLength(1)
    expect(h.state().outbox).toHaveLength(0)
  })
  it('el ámbito transaccional no abre otra conexión o transacción', async () => {
    const tx = { query: vi.fn() } as any
    const scope = transactionScope(tx)
    await scope.$transaction(async (nested) => { expect(nested).toBe(tx) })
  })
})

describe('Cola de salida: incertidumbre no significa reenviar', () => {
  it('un envío en curso bloquea su sucesor y después de expirar exige revisión', async () => {
    const h = harness(); await h.queued()
    expect((await h.outbox.claimNext(h.conversationId)).status).toBe('BUSY')
    h.state().outbox[0].leaseUntil = new Date(0)
    expect((await h.outbox.claimNext(h.conversationId)).status).toBe('REQUIRES_REVIEW')
    expect(h.state().outbox[0].status).toBe('UNCERTAIN')
    expect(h.state().tasks).toHaveLength(1)
    expect((await h.outbox.claimNext(h.conversationId)).status).toBe('REQUIRES_REVIEW')
    expect(h.state().tasks).toHaveLength(1)
  })
  it('confirmar el mismo ID externo no duplica el mensaje saliente', async () => {
    const h = harness(), handle = await h.queued()
    await h.outbox.acknowledge(handle, 'wamid.fixture')
    await h.outbox.acknowledge(handle, 'wamid.fixture')
    expect(h.state().outbound).toHaveLength(1)
    expect(h.state().outbox[0].status).toBe('SENT')
    await expect(h.outbox.acknowledge(handle, 'wamid.otro')).rejects.toThrow('otro identificador')
  })
  it('una confirmación tardía del mismo intento resuelve la incertidumbre sin reenviar', async () => {
    const h = harness(), handle = await h.queued()
    await h.outbox.uncertain(handle)
    expect((await h.outbox.acknowledge(handle, 'wamid.tardio')).status).toBe('SENT')
    expect(h.tx.task.updateMany).toHaveBeenCalledOnce()
  })
  it('un procesador distinto no puede confirmar el intento reservado', async () => {
    const h = harness(), handle = await h.queued()
    await expect(h.outbox.acknowledge({ ...handle, leaseOwner: randomUUID() }, 'wamid.falso')).rejects.toThrow('intento')
    expect(h.state().outbound).toHaveLength(0)
  })
  it('cancela una respuesta antigua si entretanto el cliente fue derivado a humano', async () => {
    const h = harness(), handle = await h.claim()
    await h.turns.complete(handle, 'Propuesta antigua'); h.state().conversation.status = 'HANDOFF'
    expect((await h.outbox.claimNext(h.conversationId)).status).toBe('CANCELLED')
  })
  it('no reutiliza como confirmación un ID que ya pertenece a otro mensaje', async () => {
    const h = harness(), handle = await h.queued()
    h.state().outbound.push({ externalMessageId: 'wamid.ajeno', direction: 'INBOUND', type: 'TEXT', text: 'Hola' })
    await expect(h.outbox.acknowledge(handle, 'wamid.ajeno')).rejects.toThrow('otro mensaje')
    expect(h.state().outbox[0].status).toBe('SENDING')
  })
  it('un SENDING sin vencimiento también es incierto, no un permiso para repetir', () => {
    expect(outboxDisposition({ status: 'SENDING', leaseUntil: null })).toBe('UNCERTAIN')
  })
})
