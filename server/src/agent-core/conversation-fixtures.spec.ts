import { describe, expect, it, vi } from 'vitest'
import { conversationFixtures } from './conversation.fixtures.js'
import { commercialRulesFixture } from './commercial-pricing.fixtures.js'
import { HeuristicAgentInterpreter } from './agent-interpreter.service.js'
import { SalesAgentService } from './sales-agent.service.js'

describe('Conversaciones: interpretación / acciones / estado seguro separados', () => {
  it.each(conversationFixtures)('$text', async (raw) => {
    const f = raw as any
    const id = '11111111-1111-4111-8111-111111111111', productId = '22222222-2222-4222-8222-222222222222'
    const rules = f.noConfig ? null : commercialRulesFixture()
    const product = { id: productId, name: f.noConfig ? 'sinreglas' : 'banner', slug: f.noConfig ? 'sinreglas' : 'banner', rules }
    const job = { id, productId, title: 'Trabajo fixture', status: f.paidStage ? 'ACEPTADO' : 'RECOPILANDO_DATOS', requirementsRevision: 1,
      requirements: f.partial ? { width: 2, widthUnit: 'm', quantity: 3 } : {} }
    const context = { facts: { job: f.active ? job : null, quote: null }, jobResolution: f.multi ? 'AMBIGUOUS' : f.active ? 'RESOLVED' : 'NO_ACTIVE_JOB',
      candidateJobs: f.multi ? [job, { ...job, id: '33333333-3333-4333-8333-333333333333' }] : [], recentMessages: [], memory: {} }
    const interpretation = await new HeuristicAgentInterpreter().interpret({ text: f.text, hasImage: f.image,
      context: { catalog: [product, { ...product, id: '44444444-4444-4444-8444-444444444444', name: 'vinil', slug: 'vinil' }],
        jobs: f.multi ? context.candidateJobs : f.active ? [job] : [], context } as any })
    expect(interpretation.intent).toBe(f.intent)
    if (f.requirements) expect(interpretation.requirements).toMatchObject(f.requirements)
    if (f.purpose) expect(interpretation.filePurpose).toBe(f.purpose)
    const db = { conversation: { findFirst: vi.fn().mockResolvedValue({ customerPhone: '51999000123' }) },
      conversationMessage: { findMany: vi.fn().mockResolvedValue([{ id, text: f.text, type: f.image ? 'IMAGE' : 'TEXT' }]) },
      product: { findMany: vi.fn().mockImplementation(async () => interpretation.productQuery === product.name || (!interpretation.productQuery && f.active) ? [product] : []) } }
    const sales = new SalesAgentService(db as any, { tenantId: id } as any, { ensureContact: vi.fn().mockResolvedValue({ id }) } as any,
      { build: vi.fn().mockResolvedValue(context) } as any, { get: vi.fn().mockResolvedValue(rules ? { rules } : null) } as any, {} as any)
    const prepared = await sales.prepareTurn(id, [id], interpretation)
    expect(prepared.plan.status).toBe(f.state)
    expect(prepared.plan.tools.map(t => t.name)).toEqual(f.tools)
    expect(prepared.plan.reply).not.toMatch(/pago confirmado|producción iniciada|descuento aprobado/i)
  })
})
