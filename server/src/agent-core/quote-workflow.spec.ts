import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '../generated/prisma/client.js'
import type { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { productConfigurationSchema } from './product-configuration.schema.js'
import { quoteInputBindingsSchema, resolveQuoteInputs } from './quote-inputs.js'
import { QuoteWorkflowService, quoteSnapshotDigest } from './quote-workflow.service.js'
import { activePriceRuleWhere } from '../pricing/active-price-rule.js'

const bindings = () => quoteInputBindingsSchema.parse({ quantity: { source: 'field', field: 'quantity' },
  widthM: { source: 'field', field: 'widthCm', multiplier: 0.01 }, heightM: { source: 'field', field: 'heightCm', multiplier: 0.01 },
  includeDesign: { source: 'constant', value: false }, installationRequired: { source: 'field', field: 'installation' },
  includeTransport: { source: 'constant', value: false } })

export const quoteRulesFixture = () => productConfigurationSchema.parse({ quotationRules: {
  pricingEngine: 'STANDARD_AREA_V1', pricingInputs: bindings(), validityDays: 7,
  requiredFields: ['widthCm', 'heightCm', 'quantity', 'installation'], fields: {
    widthCm: { type: 'number', min: 1, question: '¿Qué ancho en centímetros?' },
    heightCm: { type: 'number', min: 1, question: '¿Qué alto en centímetros?' },
    quantity: { type: 'number', min: 1, question: '¿Cuántas unidades?' },
    installation: { type: 'boolean', question: '¿Requieres instalación?' },
  },
} })

describe('Cotización: mapeo explícito, nunca precios del modelo', () => {
  it('convierte unidades solo según la configuración aprobada y no aplica descuento del cliente', () => {
    const result = resolveQuoteInputs(randomUUID(), bindings(), { widthCm: 200, heightCm: 100, quantity: 1, installation: false, discountPercent: 99 })
    expect(result.status).toBe('READY')
    if (result.status === 'READY') expect(result.input).toMatchObject({ widthM: 2, heightM: 1, discountPercent: 0, includeDesign: false, installationRequired: false })
  })
  it('no convierte una medida ambigua o un sí textual por cuenta propia', () => {
    const result = resolveQuoteInputs(randomUUID(), bindings(), { widthCm: 'dos', heightCm: 100, quantity: 1, installation: 'sí' })
    expect(result).toEqual({ status: 'MISSING_DATA', missingFields: ['widthCm', 'installation'] })
  })
  it('el mapeo debe apuntar a un campo tipado del producto', () => {
    const rules = quoteRulesFixture()
    delete rules.quotationRules.fields.widthCm
    expect(() => productConfigurationSchema.parse(rules)).toThrow()
  })
  it('el filtro de tarifas excluye demos, futuras y vencidas dentro del tenant', () => {
    const now = new Date('2026-09-08T12:00:00Z')
    expect(activePriceRuleWhere('tenant-a', now)).toEqual({ tenantId: 'tenant-a', isActive: true, isDemo: false,
      validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] })
  })
  it('la huella de aprobación es estable al reordenar claves JSONB', () => {
    expect(quoteSnapshotDigest({ b: { z: 3, a: 2 }, a: 1, absent: undefined })).toBe(quoteSnapshotDigest({ a: 1, b: { a: 2, z: 3 } }))
    expect(quoteSnapshotDigest({ total: 10 })).not.toBe(quoteSnapshotDigest({ total: 20 }))
  })
})

// Contract tests exercise the service's executed queries/decisions. They are not a substitute
// for the separately guarded PostgreSQL tests of transactions, locks and foreign keys.
function harness() {
  const tenantId = randomUUID(), productId = randomUUID(), jobId = randomUUID(), contactId = randomUUID()
  const owner = { id: 'verified-owner', role: 'OWNER' as const }
  const actor = { id: 'agent-core', role: 'SYSTEM' as const }
  const now = new Date()
  const job = { id: jobId, tenantId, productId, contactProfileId: contactId, conversationId: null, quoteId: null as string | null,
    requirementsRevision: 1, version: 1, status: 'RECOPILANDO_DATOS', requirements: { widthCm: 200, heightCm: 100, quantity: 1, installation: false } }
  const config = { id: randomUUID(), tenantId, productId, version: 1, rules: quoteRulesFixture() }
  const rate = { id: randomUUID(), tenantId, productId, name: 'SOLO FIXTURE', basePrice: 0, pricePerSquareMeter: 25, designFee: 5,
    installationFee: 20, transportFee: 5, marginPercent: 0, igvPercent: 18, isDemo: false, isActive: true, updatedAt: now }
  let quote: any = null
  let approval: any = null
  const events: any[] = []
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    agentEvent: {upsert:vi.fn().mockImplementation(async({create})=>({id:randomUUID(),jobId:null,actorType:null,...create,conversationId:create.conversationId??null,workflowId:create.workflowId??null}))},
    $queryRaw: vi.fn().mockResolvedValue([]),
    job: { findFirst: vi.fn().mockImplementation(async () => ({ ...job })), update: vi.fn().mockImplementation(async ({ data }) => {
      Object.assign(job, data, { version: job.version + 1 }); return { ...job }
    }) },
    jobEvent: { findUnique: vi.fn().mockImplementation(async ({ where }) => events.find((e) => e.eventKey === where.tenantId_eventKey.eventKey) ?? null),
      create: vi.fn().mockImplementation(async ({ data }) => { events.push(data); return data }) },
    product: { findFirst: vi.fn().mockResolvedValue({ id: productId, name: 'Producto fixture', isActive: true }) },
    productConfiguration: { findFirst: vi.fn().mockImplementation(async () => config) },
    priceRule: { findFirst: vi.fn().mockImplementation(async () => rate) },
    contactProfile: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: contactId, name: 'Cliente fixture', phone: '51999000123', company: null, customerId: randomUUID() }), update: vi.fn() },
    customer: { create: vi.fn() }, tenant: { findUniqueOrThrow: vi.fn().mockResolvedValue({ currency: 'PEN' }) },
    quote: { findFirst: vi.fn().mockImplementation(async () => quote), create: vi.fn().mockImplementation(async ({ data }) => {
      quote = { ...data, id: randomUUID(), total: new Prisma.Decimal(data.total) }; return quote
    }), update: vi.fn().mockImplementation(async ({ data }) => { Object.assign(quote, data); return quote }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    approval: { create: vi.fn().mockImplementation(async ({ data }) => { approval = { ...data, id: randomUUID(), status: 'PENDING' }; return approval }),
      findFirst: vi.fn().mockImplementation(async () => approval), update: vi.fn().mockImplementation(async ({ data }) => { Object.assign(approval, data); return approval }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    task: { upsert:vi.fn().mockImplementation(async({create})=>({...create,id:randomUUID()})),create: vi.fn().mockImplementation(async ({ data }) => ({ ...data, id: randomUUID() })), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  const db = { $transaction: async (callback: (tx: any) => Promise<unknown>) => callback(tx) } as unknown as PrismaService
  const service = new QuoteWorkflowService(db, new LocalTenantService(new ConfigService({ DEFAULT_TENANT_ID: tenantId })))
  const input = { jobId, expectedRevision: 1, requestKey: randomUUID(), evidence: 'Quiero cotizar estos requisitos' }
  return { tx, job, config, rate, service, input, owner, actor, tenantId, quote: () => quote, approval: () => approval }
}

describe('QuoteWorkflowService con persistencia simulada, sin servicios externos', () => {
  it('crea borrador + aprobación + tarea y conserva los parámetros del cálculo', async () => {
    const h = harness()
    const result = await h.service.createDraft(h.input, h.actor)
    expect(result.status).toBe('PENDING_APPROVAL')
    expect(h.quote().total.toString()).toBe('59')
    expect(h.quote().workflowSnapshot.calculationInput.widthM).toBe(2)
    expect(h.tx.approval.create).toHaveBeenCalledOnce()
    expect(h.tx.task.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'APPROVE_QUOTE' }) }))
    expect(h.job.status).toBe('REQUIERE_REVISION')
    expect(h.tx.priceRule.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: h.tenantId, isDemo: false, isActive: true })
  })
  it('repetir la operación no vuelve a calcular ni duplica presupuesto/tarea', async () => {
    const h = harness()
    const first = await h.service.createDraft(h.input, h.actor)
    expect(await h.service.createDraft(h.input, h.actor)).toEqual(first)
    expect(h.tx.quote.create).toHaveBeenCalledOnce()
    expect(h.tx.task.create).toHaveBeenCalledOnce()
    await expect(h.service.createDraft({ ...h.input, evidence: 'Distinto contenido' }, h.actor)).rejects.toThrow('clave')
    await expect(h.service.createDraft({ ...h.input, requestKey: randomUUID() }, h.actor)).rejects.toThrow('presupuesto vigente')
  })
  it.each(['configuration', 'rate', 'bindings', 'validity'] as const)('sin %s escala sin inventar una tarifa', async (missing) => {
    const h = harness()
    if (missing === 'configuration') h.tx.productConfiguration.findFirst.mockResolvedValueOnce(null as any)
    if (missing === 'rate') h.tx.priceRule.findFirst.mockResolvedValueOnce(null as any)
    if (missing === 'bindings') h.config.rules.quotationRules.pricingInputs = null
    if (missing === 'validity') h.config.rules.quotationRules.validityDays = null
    expect((await h.service.createDraft(h.input, h.actor)).status).toBe('RULE_NOT_CONFIGURED')
    expect(h.tx.quote.create).not.toHaveBeenCalled()
    expect(h.tx.task.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ type: 'CHECK_PRODUCT_RULE' }) }))
  })
  it('no asume un nombre de cliente ni medidas que faltan', async () => {
    const h = harness()
    h.tx.contactProfile.findFirstOrThrow.mockResolvedValueOnce({ name: null } as any)
    expect((await h.service.createDraft(h.input, h.actor)).status).toBe('CUSTOMER_DETAILS_REQUIRED')
    expect(h.tx.customer.create).not.toHaveBeenCalled()
    expect(h.tx.quote.create).not.toHaveBeenCalled()
    const other = harness(); other.job.requirements.widthCm = 0
    expect((await other.service.createDraft(other.input, other.actor)).status).toBe('MISSING_DATA')
  })
  it('otro cliente no puede cotizar el trabajo y una revisión obsoleta no calcula', async () => {
    const h = harness()
    await expect(h.service.createDraft(h.input, { id: 'customer', role: 'CUSTOMER', contactProfileId: randomUUID() })).rejects.toThrow('no corresponde')
    await expect(h.service.createDraft({ ...h.input, expectedRevision: 0 }, h.actor)).rejects.toThrow('requisitos cambiaron')
    expect(h.tx.quote.create).not.toHaveBeenCalled()
  })
  it('solo el dueño revisa; aprobar no envía ni inicia producción', async () => {
    const h = harness()
    await h.service.createDraft(h.input, h.actor)
    const review = { jobId: h.job.id, approvalId: h.approval().id, decision: 'APPROVED', note: 'Revisado por el dueño' }
    await expect(h.service.reviewQuote(review, h.actor)).rejects.toThrow('dueño autorizado')
    expect((await h.service.reviewQuote(review, h.owner)).status).toBe('APPROVED')
    expect(h.job.status).toBe('REQUIERE_REVISION')
    expect((await h.service.reviewQuote(review, h.owner)).status).toBe('APPROVED')
    expect(h.tx.quote.update).toHaveBeenCalledOnce()
  })
  it.each(['revision', 'config', 'rate', 'snapshot', 'total', 'expiry'] as const)('rechaza aprobación si cambió %s', async (change) => {
    const h = harness()
    await h.service.createDraft(h.input, h.actor)
    if (change === 'revision') h.job.requirementsRevision++
    if (change === 'config') h.config.version++
    if (change === 'rate') h.rate.updatedAt = new Date(h.rate.updatedAt.getTime() + 1000)
    if (change === 'snapshot') h.quote().workflowSnapshot.calculationInput.widthM = 5
    if (change === 'total') h.quote().total = new Prisma.Decimal(1)
    if (change === 'expiry') h.quote().validUntil = new Date(0)
    await expect(h.service.reviewQuote({ jobId: h.job.id, approvalId: h.approval().id, decision: 'APPROVED', note: 'Revisado' }, h.owner)).rejects.toThrow()
    expect(h.tx.quote.update).not.toHaveBeenCalled()
    expect(h.tx.approval.update).not.toHaveBeenCalled()
  })
  it('rechazo cierra la tarea y no aprueba el documento', async () => {
    const h = harness()
    await h.service.createDraft(h.input, h.actor)
    expect((await h.service.reviewQuote({ jobId: h.job.id, approvalId: h.approval().id, decision: 'REJECTED', note: 'Falta estructura' }, h.owner)).status).toBe('REJECTED')
    expect(h.tx.task.updateMany).toHaveBeenCalledOnce()
  })
  it('cambiar medidas invalida arte, fecha y presupuesto anterior sin iniciar producción', async () => {
    const h = harness()
    await h.service.createDraft(h.input, h.actor)
    const update = { ...h.input, requestKey: randomUUID(), productId: h.job.productId, values: { widthCm: 300 } }
    const result = await h.service.saveRequirements(update, h.actor)
    expect(result.requirementsRevision).toBe(2)
    expect(h.tx.quote.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'EXPIRED' } }))
    expect(h.tx.job.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ artworkApprovedAt: null, confirmedReadyAt: null, status: 'REQUIERE_REVISION' }) }))
    expect(await h.service.saveRequirements(update, h.actor)).toEqual(result)
  })
  it('los requisitos no aceptan cambios de precio ni pagos confirmados', async () => {
    const h = harness()
    await expect(h.service.saveRequirements({ ...h.input, productId: h.job.productId, values: { paymentConfirmed: true } }, h.actor)).rejects.toThrow('requisitos definidos')
    expect(h.tx.job.update).not.toHaveBeenCalled()
  })
})
