import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { Logger } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { CommercialService } from './commercial.service.js'
import { ProductConfigurationService } from './product-configuration.service.js'
import { ContextBuilderService } from './context-builder.service.js'
import { AgentTurnsService } from './agent-turns.service.js'
import { AgentOutboxService } from './agent-outbox.service.js'
import { SalesAgentService } from './sales-agent.service.js'
import { AgentInterpreterService } from './agent-interpreter.service.js'
import { WhatsAppProcessorService } from '../whatsapp/whatsapp-processor.service.js'
import { WhatsAppGatewayService } from '../whatsapp/whatsapp-gateway.service.js'
import { WhatsAppDeliveryService } from '../whatsapp/whatsapp-delivery.service.js'
import { WhatsAppOutboxWorkerService } from '../whatsapp/whatsapp-outbox-worker.service.js'
import { commercialRulesFixture, commercialValuesFixture, fictitiousTariff } from './commercial-pricing.fixtures.js'
import type { CommercialPricing } from './commercial-pricing.js'

const testUrl = process.env.TEST_DATABASE_URL
if (testUrl) {
  const url = new URL(testUrl)
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/joker_core_test') throw new Error('Solo PostgreSQL local joker_core_test.')
}
describe.skipIf(!testUrl)('Flujo comercial PostgreSQL real / APIs simuladas', () => {
  let db: PrismaService
  beforeAll(() => { db = new PrismaService(new ConfigService({ DATABASE_URL: testUrl })) })
  afterAll(async () => { await db?.$disconnect() })

  async function setup(mode: CommercialPricing['saleMode'] = 'AREA', configured = true) {
    const tenantId = randomUUID()
    await db.tenant.create({ data: { id: tenantId, name: 'TEST ONLY', slug: tenantId } })
    const config = new ConfigService({ DEFAULT_TENANT_ID: tenantId, WHATSAPP_MODE: 'simulate', AGENT_INTERPRETER: 'heuristic' })
    const tenant = new LocalTenantService(config), commercial = new CommercialService(db, tenant)
    const configurations = new ProductConfigurationService(db, tenant)
    const product = await db.product.create({ data: { tenantId, name: `Producto ${mode}`, slug: `producto-${mode}`, category: 'FICTITIOUS TEST' } })
    const tariff = await db.priceRule.create({ data: { tenantId, productId: product.id, name: 'FICTITIOUS TEST ONLY', isDemo: false,
      validFrom: new Date(Date.now() - 60000), commercialRates: fictitiousTariff } })
    if (configured) await configurations.publish(product.id, commercialRulesFixture(mode, tariff.id), 0, { id: 'test-owner', role: 'OWNER' })
    const turns = new AgentTurnsService(db, tenant)
    const sales = new SalesAgentService(db, tenant, commercial, new ContextBuilderService(db, tenant, commercial, config), configurations, turns)
    const interpreter = new AgentInterpreterService(config)
    const processor = new WhatsAppProcessorService(config, db, tenant, {} as never, {} as never, {} as never, interpreter, sales)
    const gateway = new WhatsAppGatewayService(config, {} as never)
    const send = vi.spyOn(gateway, 'sendTextRaw')
    const delivery = new WhatsAppDeliveryService(db, tenant, {} as never, {} as never, {} as never, {} as never, gateway, new AgentOutboxService(db, tenant))
    const worker = new WhatsAppOutboxWorkerService(config, db, tenant, delivery)
    const chat = await db.conversation.create({ data: { tenantId, channel: 'WHATSAPP', externalId: '51999000077', customerPhone: '51999000077', customerName: 'Cliente fixture' } })
    const inbound = async (text: string) => {
      const message = await db.conversationMessage.create({ data: { conversationId: chat.id, direction: 'INBOUND', type: 'TEXT', status: 'BUFFERED', text } })
      await db.conversation.update({ where: { id: chat.id }, data: { lastInboundAt: new Date(Date.now() - 30000) } })
      await processor.processConversation(chat.id)
      return message
    }
    const jobs = () => db.job.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })
    return { tenantId, config, tenant, product, tariff, configurations, turns, sales, interpreter, processor, gateway, send, worker, chat, inbound, jobs }
  }

  it.each(['UNIT', 'AREA', 'LINEAR', 'FIXED', 'PACKAGE'] as const)('%s: BUFFERED → tools → Quote pendiente → Outbox → SENT simulado', async mode => {
    const h = await setup(mode)
    const all = commercialValuesFixture(mode)
    const allowed = Object.keys(commercialRulesFixture(mode).quotationRules.fields)
    const fields = Object.entries(all).filter(([k]) => allowed.includes(k)).map(([k, v]) => `${k}=${v}`).join('; ')
    const message = await h.inbound(`${h.product.name} ${fields}`)
    const jobs = await h.jobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.requirementsRevision).toBe(1)
    expect(jobs[0]!.status).toBe('REQUIERE_REVISION')
    expect(await db.agentToolCall.count({ where: { tenantId: h.tenantId } })).toBe(3)
    const quote = await db.quote.findFirstOrThrow({ where: { tenantId: h.tenantId } })
    expect(quote.status).toBe('PENDING_APPROVAL')
    expect(quote.workflowSnapshot).toMatchObject({ jobId: jobs[0]!.id, requirementsRevision: 1, configurationVersion: 1,
      priceRuleId: h.tariff.id, commercialPricing: { saleMode: mode } })
    expect(await db.agentOutbox.count({ where: { tenantId: h.tenantId, status: 'PENDING' } })).toBe(1)
    await h.worker.processPending()
    await h.worker.processPending()
    expect(h.send).toHaveBeenCalledOnce()
    expect(await db.agentOutbox.count({ where: { tenantId: h.tenantId, status: 'SENT' } })).toBe(1)
    expect((await db.conversationMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe('PROCESSED')
    expect(await db.conversationMessage.count({ where: { conversationId: h.chat.id, direction: 'OUTBOUND' } })).toBe(1)
    expect(h.send.mock.calls[0]![1]).toContain('pendiente de revisión')
  })

  it('guarda medidas ambiguas pendientes y solo cotiza después de aclarar unidad y cantidad', async () => {
    const h = await setup()
    await h.inbound(`${h.product.name} 2 x 1`)
    expect((await h.jobs())[0]!.requirements).toMatchObject({ width: 2, height: 1, widthUnit: null, heightUnit: null })
    expect(await db.quote.count({ where: { tenantId: h.tenantId } })).toBe(0)
    await h.inbound('metros')
    expect((await h.jobs())[0]!.requirements).toMatchObject({ widthUnit: 'm', heightUnit: 'm' })
    expect(await db.quote.count({ where: { tenantId: h.tenantId } })).toBe(0)
    await h.inbound('3')
    expect(await db.quote.count({ where: { tenantId: h.tenantId } })).toBe(1)
    await h.inbound('4 x 2')
    const job = (await h.jobs())[0]!
    expect(job.requirements).toMatchObject({ width: 4, height: 2, widthUnit: null, heightUnit: null })
    expect((await db.quote.findUniqueOrThrow({ where: { id: job.quoteId! } })).status).toBe('EXPIRED')
  })

  it('completa requisitos en varios mensajes y no mezcla dos trabajos del contacto', async () => {
    const h = await setup()
    await h.inbound(`${h.product.name} width=2; widthUnit=m; quantity=3`)
    expect(await db.quote.count({ where: { tenantId: h.tenantId } })).toBe(0)
    await h.inbound('height=1; heightUnit=m')
    const first = (await h.jobs())[0]!
    expect(first.requirementsRevision).toBe(2)
    await h.inbound(`otro trabajo aparte ${h.product.name} width=5; widthUnit=m; height=1; heightUnit=m; quantity=1`)
    expect(await h.jobs()).toHaveLength(2)
    await h.inbound('width=9; widthUnit=m')
    expect((await h.jobs()).map(j => j.requirementsRevision)).toEqual([2, 1])
    await h.inbound(`${first.id} width=4; widthUnit=m`)
    const jobs = await h.jobs()
    expect(jobs[0]!.requirements).toMatchObject({ width: 4, height: 1, quantity: 3 })
    expect(jobs[1]!.requirements).toMatchObject({ width: 5, height: 1, quantity: 1 })
    expect(jobs.map(j => j.requirementsRevision)).toEqual([3, 1])
    expect((await db.quote.findUniqueOrThrow({ where: { id: first.quoteId! } })).status).toBe('EXPIRED')
  })

  it('recupera crash después de tools con los mismos recibos: una quote, un job y una salida', async () => {
    const h = await setup('UNIT')
    const finish = vi.spyOn(h.sales, 'finishTurn').mockRejectedValueOnce(new Error('CRASH AFTER TOOLS'))
    const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try { await h.inbound(`${h.product.name} quantity=3`) } finally { logger.mockRestore(); finish.mockRestore() }
    expect(await db.quote.count({ where: { tenantId: h.tenantId } })).toBe(1)
    expect(await db.agentOutbox.count({ where: { tenantId: h.tenantId } })).toBe(0)
    await db.agentTurn.updateMany({ where: { tenantId: h.tenantId }, data: { leaseUntil: new Date(0) } })
    const interpret = vi.spyOn(h.interpreter, 'interpret')
    await h.processor.processConversation(h.chat.id)
    await h.worker.processPending()
    expect(interpret).not.toHaveBeenCalled()
    expect(await h.jobs()).toHaveLength(1)
    expect(await db.quote.count({ where: { tenantId: h.tenantId } })).toBe(1)
    expect(await db.agentToolCall.count({ where: { tenantId: h.tenantId } })).toBe(3)
    expect(h.send).toHaveBeenCalledOnce()
  })

  it('no completa un turno mientras falte un recibo del plan guardado', async () => {
    const h = await setup('UNIT')
    const message = await db.conversationMessage.create({ data: { conversationId: h.chat.id, direction: 'INBOUND', type: 'TEXT', status: 'BUFFERED', text: `${h.product.name} quantity=2` } })
    await db.conversation.update({ where: { id: h.chat.id }, data: { lastInboundAt: new Date(Date.now() - 30000) } })
    const claim = await h.sales.claimTurn(h.chat.id)
    if (claim.status !== 'CLAIMED') throw new Error('No claim')
    const prepared = await h.sales.prepareTurn(h.chat.id, [message.id], { intent: 'VENTA_NUEVA', productQuery: h.product.name, requirements: { quantity: 2 } })
    await h.sales.saveTurnPlan(claim.handle, prepared.plan)
    await expect(h.sales.finishTurn(claim.handle, 'Ya está calculado')).rejects.toThrow('herramientas pendientes')
    expect(await db.agentOutbox.count({ where: { tenantId: h.tenantId } })).toBe(0)
    const reply = await h.sales.executePlan(claim.handle, prepared.plan)
    await h.sales.finishTurn(claim.handle, reply)
    expect(await db.agentOutbox.count({ where: { tenantId: h.tenantId } })).toBe(1)
  })

  it.each([1, 2])('recupera después del recibo de herramienta %s sin duplicar sus efectos', async after => {
    const h = await setup('UNIT')
    const original = h.sales.executeCustomerTool.bind(h.sales)
    let calls = 0
    const spy = vi.spyOn(h.sales, 'executeCustomerTool').mockImplementation(async (...args) => {
      const result = await original(...args)
      if (++calls === after) throw new Error('Crash después de commit del recibo')
      return result
    })
    const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try { await h.inbound(`${h.product.name} quantity=3`) } finally { spy.mockRestore(); logger.mockRestore() }
    await db.agentTurn.updateMany({ where: { tenantId: h.tenantId }, data: { leaseUntil: new Date(0) } })
    await h.processor.processConversation(h.chat.id)
    expect(await h.jobs()).toHaveLength(1)
    expect((await h.jobs())[0]!.requirementsRevision).toBe(1)
    expect(await db.quote.count({ where: { tenantId: h.tenantId } })).toBe(1)
    expect(await db.agentToolCall.count({ where: { tenantId: h.tenantId } })).toBe(3)
  })

  it.each(['missing', 'demo', 'inactive', 'expired', 'future', 'foreign', 'unknown-rule'] as const)('no cotiza con configuración/tarifa %s', async kind => {
    const h = await setup('UNIT', kind !== 'missing')
    if (kind === 'demo') await db.priceRule.update({ where: { id: h.tariff.id }, data: { isDemo: true } })
    if (kind === 'inactive') await db.priceRule.update({ where: { id: h.tariff.id }, data: { isActive: false } })
    if (kind === 'expired') await db.priceRule.update({ where: { id: h.tariff.id }, data: { validUntil: new Date(0) } })
    if (kind === 'future') await db.priceRule.update({ where: { id: h.tariff.id }, data: { validFrom: new Date('2099-01-01') } })
    if (kind === 'foreign') await h.configurations.publish(h.product.id, commercialRulesFixture('UNIT', (await setup('UNIT')).tariff.id), 1, { id: 'owner', role: 'OWNER' })
    if (kind === 'unknown-rule') {
      const record = await db.productConfiguration.findFirstOrThrow({ where: { tenantId: h.tenantId } })
      const rules = commercialRulesFixture('UNIT', h.tariff.id) as any
      rules.commercialPricing.ruleRef = 'UNKNOWN'
      await db.productConfiguration.update({ where: { id: record.id }, data: { rules } })
    }
    await h.inbound(`${h.product.name} quantity=3`)
    expect(await db.quote.count({ where: { tenantId: h.tenantId } })).toBe(0)
    expect(await db.task.count({ where: { tenantId: h.tenantId, type: 'CHECK_PRODUCT_RULE' } })).toBe(1)
  })

  it('aviso de pago pasa a PAGO_POR_CONFIRMAR sin aprobación y solicitud humana detiene venta', async () => {
    const h = await setup('UNIT')
    await h.inbound(`${h.product.name} quantity=3`)
    const job = (await h.jobs())[0]!
    // Fixture represents a previously accepted quote; not an API that grants acceptance.
    await db.job.update({ where: { id: job.id }, data: { status: 'ESPERANDO_ADELANTO' } })
    await h.inbound('ya hice yape')
    expect((await h.jobs())[0]!.status).toBe('PAGO_POR_CONFIRMAR')
    expect(await db.approval.count({ where: { tenantId: h.tenantId, type: 'PAYMENT', status: 'APPROVED' } })).toBe(0)
    await h.inbound('quiero hablar con una persona')
    expect((await db.conversation.findUniqueOrThrow({ where: { id: h.chat.id } })).status).toBe('HANDOFF')
    const before = await db.agentToolCall.count({ where: { tenantId: h.tenantId } })
    await h.inbound(`${h.product.name} quantity=9`)
    expect(await db.agentToolCall.count({ where: { tenantId: h.tenantId } })).toBe(before)
  })
})
