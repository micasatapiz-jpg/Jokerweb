import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { CommercialService } from './commercial.service.js'
import { ProductConfigurationService } from './product-configuration.service.js'
import { QuoteWorkflowService } from './quote-workflow.service.js'
import { CustomerToolsService } from './customer-tools.service.js'
import { AgentTurnsService } from './agent-turns.service.js'
import { AgentOutboxService } from './agent-outbox.service.js'

const testUrl = process.env.TEST_DATABASE_URL
// Integration tests never fall back to the application's DATABASE_URL.
if (testUrl) {
  const url = new URL(testUrl)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/joker_core_test') throw new Error('Solo se permite la base local aislada joker_core_test.')
}
describe.skipIf(!testUrl)('CommercialService / PostgreSQL aislado', () => {
  const tenantId = randomUUID()
  const otherTenantId = randomUUID()
  const config = new ConfigService({ DATABASE_URL: testUrl, DEFAULT_TENANT_ID: tenantId })
  let db: PrismaService
  let service: CommercialService
  const owner = { id: 'verified-owner', role: 'OWNER' as const }
  beforeAll(async () => {
    db = new PrismaService(config)
    service = new CommercialService(db, new LocalTenantService(config))
    await db.tenant.createMany({ data: [
      { id: tenantId, name: 'Pruebas', slug: tenantId }, { id: otherTenantId, name: 'Otro', slug: otherTenantId },
    ] })
  })
  afterAll(async () => { await db?.$disconnect() })

  it('normaliza teléfono y mantiene clasificación proveedor al actualizar nombre', async () => {
    const contact = await service.ensureContact({ phone: '+51999000111', name: 'Proveedor' })
    await db.contactProfile.update({ where: { id: contact.id }, data: { type: 'PROVEEDOR' } })
    const updated = await service.ensureContact({ phone: '51999000111', name: 'Acrílicos' })
    expect(updated.id).toBe(contact.id)
    expect(updated.type).toBe('PROVEEDOR')
  })

  it('varios trabajos exigen desambiguación y no cruzan empresas', async () => {
    const contact = await service.ensureContact({ phone: '51999000222' })
    await service.createJob({ contactProfileId: contact.id, title: 'Trabajo A' })
    const second = await service.createJob({ contactProfileId: contact.id, title: 'Trabajo B' })
    expect((await service.resolveJob(contact.id)).status).toBe('AMBIGUOUS')
    expect((await service.resolveJob(contact.id, second.id)).status).toBe('RESOLVED')
    const foreign = await db.contactProfile.create({ data: { tenantId: otherTenantId, phone: '51999000222' } })
    await expect(service.createJob({ contactProfileId: foreign.id, title: 'Incorrecto' })).rejects.toThrow('Contacto no encontrado')
    await expect(db.job.create({ data: { tenantId, contactProfileId: foreign.id, title: 'FK cruzada' } })).rejects.toThrow()
  })

  it('evento repetido no duplica tarea ni historial; cambios no se pisan', async () => {
    const contact = await service.ensureContact({ phone: '51999000333' })
    const job = await service.createJob({ contactProfileId: contact.id, title: 'Prueba' })
    const customer = { id: contact.id, role: 'CUSTOMER' as const, contactProfileId: contact.id }
    const event = { eventKey: randomUUID(), type: 'REQUEST_HUMAN', evidence: 'Quiero hablar con una persona' }
    const first = await service.applyJobEvent(job.id, event, customer)
    const again = await service.applyJobEvent(job.id, event, customer)
    expect(again.version).toBe(first.version)
    expect(await db.task.count({ where: { tenantId, jobId: job.id } })).toBe(1)
    expect(await db.jobEvent.count({ where: { tenantId, jobId: job.id } })).toBe(1)
    await expect(service.applyJobEvent(job.id, { ...event, evidence: 'otra petición' }, customer)).rejects.toThrow('duplicado')
    await expect(service.applyJobEvent(job.id, { ...event, eventKey: randomUUID() }, { ...customer, contactProfileId: randomUUID() })).rejects.toThrow('no corresponde')
  })

  it('el pago exige aprobación del dueño, del mismo trabajo y monto', async () => {
    const contact = await service.ensureContact({ phone: '51999000444' })
    const job = await service.createJob({ contactProfileId: contact.id, title: 'Pago' })
    await db.job.update({ where: { id: job.id }, data: { status: 'ESPERANDO_ADELANTO' } })
    const customer = { id: contact.id, role: 'CUSTOMER' as const, contactProfileId: contact.id }
    const reported = await service.applyJobEvent(job.id, { eventKey: randomUUID(), type: 'PAYMENT_REPORTED', evidence: 'Envié 400', amount: 400 }, customer)
    expect(reported.status).toBe('PAGO_POR_CONFIRMAR')
    const approval = await service.createApproval({ jobId: job.id, type: 'PAYMENT', dedupeKey: randomUUID(), payload: { amount: 400 } })
    const confirmed = { eventKey: randomUUID(), type: 'PAYMENT_CONFIRMED', evidence: 'Depósito verificado', amount: 400, approvalId: approval.id }
    await expect(service.applyJobEvent(job.id, confirmed, owner)).rejects.toThrow('aprobación válida')
    await expect(service.reviewApproval(approval.id, 'APPROVED', 'Imagen', customer)).rejects.toThrow('dueño')
    await service.reviewApproval(approval.id, 'APPROVED', 'Verificado en la cuenta', owner)
    await expect(service.applyJobEvent(job.id, { ...confirmed, amount: 500 }, owner)).rejects.toThrow('monto')
    expect((await service.applyJobEvent(job.id, confirmed, owner)).status).toBe('PAGO_CONFIRMADO')
    await expect(service.reviewApproval(approval.id, 'REJECTED', 'Cambio', owner)).rejects.toThrow('ya revisada')
  })

  it('fecha solicitada no reemplaza fecha confirmada y nunca entrega automáticamente', async () => {
    const contact = await service.ensureContact({ phone: '51999000555' })
    const job = await service.createJob({ contactProfileId: contact.id, title: 'Fecha' })
    const readyAt = '2026-09-20T18:00:00Z'
    const approval = await service.createApproval({ jobId: job.id, type: 'DELIVERY_DATE', dedupeKey: randomUUID(), payload: { readyAt } })
    await service.reviewApproval(approval.id, 'APPROVED', 'Fecha confirmada', owner)
    await service.applyJobEvent(job.id, { eventKey: randomUUID(), type: 'SET_DELIVERY_DATE', evidence: 'Confirmación dueño', readyAt, approvalId: approval.id }, owner)
    const request = await service.applyJobEvent(job.id, { eventKey: randomUUID(), type: 'REQUEST_EARLIER_DELIVERY', evidence: '¿Puede estar mañana?' }, owner)
    expect(request.confirmedReadyAt?.toISOString()).toBe(new Date(readyAt).toISOString())
    const elapsed = await service.applyJobEvent(job.id, { eventKey: randomUUID(), type: 'DATE_ELAPSED', evidence: 'Reloj' }, { id: 'timer', role: 'SYSTEM' })
    expect(elapsed.deliveredAt).toBeNull()
    expect(elapsed.status).toBe('NUEVO')
  })

  it('resúmenes versionados usan únicamente mensajes del chat correcto', async () => {
    const contact = await service.ensureContact({ phone: '51999000666' })
    const conversation = await db.conversation.create({ data: { tenantId, channel: 'WHATSAPP', externalId: contact.phone, customerPhone: contact.phone } })
    const message = await db.conversationMessage.create({ data: { conversationId: conversation.id, direction: 'INBOUND', type: 'TEXT', text: 'Prefiero WhatsApp' } })
    const input = { conversationId: conversation.id, contactProfileId: contact.id, text: 'Prefiere WhatsApp', sourceMessageIds: [message.id] }
    expect((await service.saveSummary(input)).version).toBe(1)
    expect((await service.saveSummary(input)).version).toBe(2)
    await expect(service.saveSummary({ ...input, sourceMessageIds: [randomUUID()] })).rejects.toThrow('fuentes ajenas')
  })

  it('las reglas son snapshots inmutables, requieren dueño y comprueban versión', async () => {
    const rules = new ProductConfigurationService(db, new LocalTenantService(config))
    const product = await db.product.create({ data: { tenantId, name: 'Configuración fixture', slug: randomUUID(), category: 'TEST' } })
    const input = { quotationRules: {} }
    await expect(rules.publish(product.id, input, 0, { id: 'sales', role: 'SALES' })).rejects.toThrow('dueño')
    const first = await rules.publish(product.id, input, 0, owner)
    const second = await rules.publish(product.id, { ...input, fileRules: { sendAsDocument: true } }, 1, owner)
    expect(second.version).toBe(2)
    expect(first.id).not.toBe(second.id)
    expect((await db.productConfiguration.findUniqueOrThrow({ where: { id: first.id } })).rules).toEqual(first.rules)
    await expect(rules.publish(product.id, input, 1, owner)).rejects.toThrow('versión')
    const other = await db.product.create({ data: { tenantId: otherTenantId, name: 'Ajeno', slug: randomUUID(), category: 'TEST' } })
    await expect(rules.publish(other.id, input, 0, owner)).rejects.toThrow('no encontrado')
  })

  it('herramientas del cliente: creación concurrente estable y rechazo de fuentes de otro chat', async () => {
    const tenant = new LocalTenantService(config)
    const tools = new CustomerToolsService(db, tenant, service, new ProductConfigurationService(db, tenant), new QuoteWorkflowService(db, tenant))
    const conversation = await db.conversation.create({ data: { tenantId, channel: 'WHATSAPP', externalId: '51999000888', customerPhone: '51999000888', customerName: 'Herramientas fixture' } })
    const message = await db.conversationMessage.create({ data: { conversationId: conversation.id, direction: 'INBOUND', type: 'TEXT', text: 'Quiero un letrero nuevo' } })
    const source = { conversationId: conversation.id, sourceMessageIds: [message.id], callId: 'create-1' }
    const tool = { name: 'createJob', args: { title: 'Letrero de prueba' } }
    const results = await Promise.all([tools.execute(source, tool), tools.execute({ ...source, callId: 'create-retry' }, tool)])
    expect(results.map((result) => (result as { created: boolean }).created).sort()).toEqual([false, true])
    expect(await db.job.count({ where: { tenantId, conversationId: conversation.id } })).toBe(1)
    await expect(tools.execute({ ...source, sourceMessageIds: [randomUUID()] }, { name: 'findJobs', args: {} })).rejects.toThrow('no pertenecen')
    await db.conversation.update({ where: { id: conversation.id }, data: { status: 'HANDOFF' } })
    await expect(tools.execute(source, { name: 'createJob', args: { title: 'No crear', requestSlot: 1 } })).rejects.toThrow('atención humana')
    expect(await db.job.count({ where: { tenantId, conversationId: conversation.id } })).toBe(1)
  })

  it('turnos: una sola réplica obtiene la reserva y recupera el mismo plan/recibos al expirar', async () => {
    const turns = new AgentTurnsService(db, new LocalTenantService(config))
    const conversation = await db.conversation.create({ data: { tenantId, channel: 'WHATSAPP', externalId: '51999000901', customerPhone: '51999000901', customerName: 'Turno fixture', lastInboundAt: new Date(Date.now() - 30000) } })
    const message = await db.conversationMessage.create({ data: { conversationId: conversation.id, direction: 'INBOUND', type: 'TEXT', status: 'BUFFERED', text: 'Quiero un letrero' } })
    const claims = await Promise.all([turns.claimNext(conversation.id), turns.claimNext(conversation.id)])
    expect(claims.map((result) => result.status).sort()).toEqual(['BUSY', 'CLAIMED'])
    const claim = claims.find((result) => result.status === 'CLAIMED')!
    if (claim.status !== 'CLAIMED') throw new Error('No se reservó el turno.')
    await turns.savePlan(claim.handle, { expectedRevision: 0, next: 'createJob' })
    const tool = { name: 'createJob', args: { title: 'Pedido con recibo durable' } }
    const first = await turns.runCustomerTool(claim.handle, 'job-0', tool)
    await db.agentTurn.update({ where: { id: claim.handle.turnId }, data: { leaseUntil: new Date(0) } })
    const recovered = await turns.claimNext(conversation.id)
    if (recovered.status !== 'CLAIMED') throw new Error('No se recuperó el turno.')
    expect(recovered.plan).toEqual({ expectedRevision: 0, next: 'createJob' })
    expect(recovered.sourceMessageIds).toEqual([message.id])
    await expect(turns.runCustomerTool(claim.handle, 'job-1', tool)).rejects.toThrow('reserva')
    expect(await turns.runCustomerTool(recovered.handle, 'job-0', tool)).toEqual(first)
    expect(await db.job.count({ where: { tenantId, conversationId: conversation.id } })).toBe(1)
    expect(await db.agentToolCall.count({ where: { tenantId, turnId: recovered.handle.turnId } })).toBe(1)
    const later = await db.conversationMessage.create({ data: { conversationId: conversation.id, direction: 'INBOUND', type: 'TEXT', status: 'BUFFERED', text: 'También tengo una consulta adicional' } })
    await turns.complete(recovered.handle, 'Respuesta pendiente de envío')
    expect((await db.conversationMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('PROCESSED')
    expect((await db.conversationMessage.findUniqueOrThrow({ where: { id: later.id } })).status).toBe('BUFFERED')
    expect(await db.agentOutbox.count({ where: { tenantId, turnId: recovered.handle.turnId, status: 'PENDING' } })).toBe(1)
    const foreignTurns = new AgentTurnsService(db, new LocalTenantService(new ConfigService({ DEFAULT_TENANT_ID: otherTenantId })))
    await expect(foreignTurns.savePlan(recovered.handle, {})).rejects.toThrow('no encontrado')
  })

  it('un fallo después del efecto comercial revierte también el trabajo, no solo el recibo', async () => {
    const turns = new AgentTurnsService(db, new LocalTenantService(config))
    const conversation = await db.conversation.create({ data: { tenantId, channel: 'WHATSAPP', externalId: '51999000902', customerPhone: '51999000902', customerName: 'Rollback fixture', lastInboundAt: new Date(Date.now() - 30000) } })
    await db.conversationMessage.create({ data: { conversationId: conversation.id, direction: 'INBOUND', type: 'TEXT', status: 'BUFFERED', text: 'Crear un pedido' } })
    const claim = await turns.claimNext(conversation.id)
    if (claim.status !== 'CLAIMED') throw new Error('No se reservó el turno.')
    const original = CustomerToolsService.prototype.execute
    const spy = vi.spyOn(CustomerToolsService.prototype, 'execute').mockImplementationOnce(async function (this: CustomerToolsService, ...args) {
      await original.apply(this, args)
      throw new Error('Fallo simulado después de crear trabajo y antes del recibo')
    })
    const tool = { name: 'createJob', args: { title: 'Debe revertirse' } }
    try { await expect(turns.runCustomerTool(claim.handle, 'job-0', tool)).rejects.toThrow('antes del recibo') } finally { spy.mockRestore() }
    expect(await db.job.count({ where: { tenantId, conversationId: conversation.id } })).toBe(0)
    expect(await db.agentToolCall.count({ where: { tenantId, turnId: claim.handle.turnId } })).toBe(0)
    await turns.runCustomerTool(claim.handle, 'job-0', tool)
    expect(await db.job.count({ where: { tenantId, conversationId: conversation.id } })).toBe(1)
    expect(await db.agentToolCall.count({ where: { tenantId, turnId: claim.handle.turnId } })).toBe(1)
  })

  it('outbox real: el vencimiento no reenvía y una confirmación tardía resuelve sin duplicar', async () => {
    const tenant = new LocalTenantService(config), turns = new AgentTurnsService(db, tenant), outbox = new AgentOutboxService(db, tenant)
    const conversation = await db.conversation.create({ data: { tenantId, channel: 'WHATSAPP', externalId: '51999000903', customerPhone: '51999000903', lastInboundAt: new Date(Date.now() - 30000) } })
    await db.conversationMessage.create({ data: { conversationId: conversation.id, direction: 'INBOUND', type: 'TEXT', status: 'BUFFERED', text: 'Hola' } })
    const turn = await turns.claimNext(conversation.id)
    if (turn.status !== 'CLAIMED') throw new Error('No se reservó el turno.')
    await turns.complete(turn.handle, 'Acuse de prueba sin conexión a Meta')
    const claimed = await outbox.claimNext(conversation.id)
    if (claimed.status !== 'CLAIMED') throw new Error('No se reservó el envío.')
    expect((await outbox.claimNext(conversation.id)).status).toBe('BUSY')
    await db.agentOutbox.update({ where: { id: claimed.handle.outboxId }, data: { leaseUntil: new Date(0) } })
    expect((await outbox.claimNext(conversation.id)).status).toBe('REQUIRES_REVIEW')
    expect((await outbox.claimNext(conversation.id)).status).toBe('REQUIRES_REVIEW')
    await outbox.acknowledge(claimed.handle, 'wamid.integration-fixture')
    await outbox.acknowledge(claimed.handle, 'wamid.integration-fixture')
    expect(await db.conversationMessage.count({ where: { conversationId: conversation.id, direction: 'OUTBOUND' } })).toBe(1)
    expect(await db.task.count({ where: { tenantId, dedupeKey: `outbox-review:${claimed.handle.outboxId}`, status: 'DONE' } })).toBe(1)
    expect((await outbox.claimNext(conversation.id)).status).toBe('EMPTY')
  })

  it('cotización completa conserva JSONB, aprobación, idempotencia concurrente y rechaza un cambio posterior', async () => {
    const workflow = new QuoteWorkflowService(db, new LocalTenantService(config))
    const configurations = new ProductConfigurationService(db, new LocalTenantService(config))
    const product = await db.product.create({ data: { tenantId, name: 'Presupuesto fixture', slug: randomUUID(), category: 'TEST' } })
    await configurations.publish(product.id, { quotationRules: {
      pricingEngine: 'STANDARD_AREA_V1', validityDays: 7,
      requiredFields: ['widthM', 'heightM'], fields: {
        widthM: { type: 'number', min: 0.01, question: '¿Qué ancho en metros?' },
        heightM: { type: 'number', min: 0.01, question: '¿Qué alto en metros?' },
      }, pricingInputs: { quantity: { source: 'constant', value: 1 },
        widthM: { source: 'field', field: 'widthM' }, heightM: { source: 'field', field: 'heightM' },
        includeDesign: { source: 'constant', value: false }, installationRequired: { source: 'constant', value: false },
        includeTransport: { source: 'constant', value: false } },
    } }, 0, owner)
    // These rates exist only in the explicitly guarded, disposable test database.
    const now = Date.now()
    await db.priceRule.create({ data: { tenantId, productId: product.id, name: 'TEST ONLY', isDemo: false, pricePerSquareMeter: 25, igvPercent: 18,
      validFrom: new Date(now - 86400000) } })
    await db.priceRule.createMany({ data: [
      { tenantId, productId: product.id, name: 'DEMO EXCLUDED', isDemo: true, pricePerSquareMeter: 9999, validFrom: new Date(now - 3600000) },
      { tenantId, productId: product.id, name: 'FUTURE EXCLUDED', isDemo: false, pricePerSquareMeter: 9999, validFrom: new Date(now + 3600000) },
      { tenantId, productId: product.id, name: 'EXPIRED EXCLUDED', isDemo: false, pricePerSquareMeter: 9999, validFrom: new Date(now - 1800000), validUntil: new Date(now - 60000) },
    ] })
    const contact = await service.ensureContact({ phone: '51999000777', name: 'Prueba presupuesto' })
    const job = await service.createJob({ contactProfileId: contact.id, title: 'Presupuesto' })
    const customer = { id: contact.id, role: 'CUSTOMER' as const, contactProfileId: contact.id }
    await workflow.saveRequirements({ jobId: job.id, productId: product.id, expectedRevision: 0, requestKey: randomUUID(), evidence: '2 metros por 1 metro', values: { widthM: 2, heightM: 1 } }, customer)
    const input = { jobId: job.id, expectedRevision: 1, requestKey: randomUUID(), evidence: 'Cotizar las medidas confirmadas' }
    const [first, again] = await Promise.all([workflow.createDraft(input, owner), workflow.createDraft(input, owner)])
    expect(again).toEqual(first)
    if (first.status !== 'PENDING_APPROVAL') throw new Error('No se creó el borrador esperado.')
    expect(await db.quote.count({ where: { tenantId, id: first.quoteId } })).toBe(1)
    await expect(service.reviewApproval(first.approvalId, 'APPROVED', 'Bypass', owner)).rejects.toThrow('flujo de presupuesto')
    const reviewed = await workflow.reviewQuote({ jobId: job.id, approvalId: first.approvalId, decision: 'APPROVED', note: 'Revisado contra tarifa' }, owner)
    expect(reviewed.total.toString()).toBe('59')
    expect(reviewed.status).toBe('APPROVED')
    await service.applyJobEvent(job.id, { eventKey: randomUUID(), type: 'QUOTE_ISSUED', quoteId: first.quoteId, evidence: 'Documento enviado' }, owner)
    expect((await service.applyJobEvent(job.id, { eventKey: randomUUID(), type: 'CUSTOMER_ACCEPTED', evidence: 'Acepto el presupuesto' }, customer)).status).toBe('ACEPTADO')
    await workflow.saveRequirements({ jobId: job.id, productId: product.id, expectedRevision: 1, requestKey: randomUUID(), evidence: 'Ahora necesito 3 metros', values: { widthM: 3 } }, customer)
    expect((await db.quote.findUniqueOrThrow({ where: { id: first.quoteId } })).status).toBe('EXPIRED')
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('REQUIERE_REVISION')
    await expect(service.applyJobEvent(job.id, { eventKey: randomUUID(), type: 'QUOTE_ISSUED', quoteId: first.quoteId, evidence: 'Reusar presupuesto antiguo' }, owner)).rejects.toThrow()
  })
})
