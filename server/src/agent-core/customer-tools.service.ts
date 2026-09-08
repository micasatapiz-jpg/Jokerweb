import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { CommercialService } from './commercial.service.js'
import { ProductConfigurationService } from './product-configuration.service.js'
import { QuoteWorkflowService } from './quote-workflow.service.js'
import { preferencesSchema } from './commercial.schemas.js'

const empty = z.object({}).strict()
const jobSelection = z.object({ jobId: z.uuid().optional() }).strict()
export const customerToolSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('findContactProfile'), args: empty }).strict(),
  z.object({ name: z.literal('findCustomer'), args: empty }).strict(),
  z.object({ name: z.literal('findJobs'), args: z.object({ includeClosed: z.boolean().default(false) }).strict() }).strict(),
  z.object({ name: z.literal('findQuote'), args: jobSelection }).strict(),
  z.object({ name: z.literal('findProduct'), args: z.object({ query: z.string().trim().min(1).max(150) }).strict() }).strict(),
  z.object({ name: z.literal('getProductConfiguration'), args: z.object({ productId: z.uuid() }).strict() }).strict(),
  z.object({ name: z.literal('createJob'), args: z.object({ title: z.string().trim().min(1).max(200), requestSlot: z.number().int().min(0).max(9).default(0) }).strict() }).strict(),
  z.object({ name: z.literal('saveRequirements'), args: z.object({ jobId: z.uuid(), productId: z.uuid(), expectedRevision: z.number().int().nonnegative(),
    values: z.record(z.string(), z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()])).refine((values) => Object.keys(values).length <= 60),
  }).strict() }).strict(),
  z.object({ name: z.literal('calculateQuote'), args: z.object({ jobId: z.uuid(), expectedRevision: z.number().int().nonnegative() }).strict() }).strict(),
  z.object({ name: z.literal('updatePreferences'), args: preferencesSchema }).strict(),
  z.object({ name: z.literal('updateJobStatus'), args: z.object({ jobId: z.uuid(),
    event: z.enum(['CUSTOMER_ACCEPTED', 'PAYMENT_REPORTED', 'REQUEST_EARLIER_DELIVERY', 'REQUEST_HUMAN', 'COMPLAINT', 'DELIVERY_CONFIRMED', 'REQUIREMENTS_CHANGED']),
    amount: z.number().positive().max(10000000).optional(), quoteId: z.uuid().optional(),
  }).strict() }).strict(),
])

const sourceSchema = z.object({ conversationId: z.uuid(), sourceMessageIds: z.array(z.uuid()).min(1).max(30),
  callId: z.string().min(1).max(150) }).strict()
export type CustomerToolSource = z.infer<typeof sourceSchema>

// Internal adapter only: no HTTP route. The model supplies the tool/args, never this source.
// The verified channel supplies persisted inbound IDs and its stable tool-call ID.
@Injectable()
export class CustomerToolsService {
  constructor(private readonly db: PrismaService, private readonly tenant: LocalTenantService,
    private readonly commercial: CommercialService, private readonly configurations: ProductConfigurationService,
    private readonly quotes: QuoteWorkflowService) {}

  async execute(rawSource: CustomerToolSource, rawTool: unknown) {
    const source = sourceSchema.parse(rawSource)
    const tool = customerToolSchema.parse(rawTool)
    const tenantId = this.tenant.tenantId
    const conversation = await this.db.conversation.findFirst({ where: { id: source.conversationId, tenantId } })
    if (!conversation?.customerPhone) throw new NotFoundException('Conversación no encontrada.')
    const messages = await this.db.conversationMessage.findMany({ where: { conversationId: conversation.id, direction: 'INBOUND',
      id: { in: source.sourceMessageIds } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    if (messages.length !== new Set(source.sourceMessageIds).size) throw new ForbiddenException('Los mensajes fuente no pertenecen a esta conversación.')
    const contact = await this.commercial.ensureContact({ phone: conversation.customerPhone, name: conversation.customerName ?? undefined })
    const actor = { id: contact.id, role: 'CUSTOMER' as const, contactProfileId: contact.id }
    const turnKey = createHash('sha256').update(JSON.stringify({ conversationId: conversation.id, messages: [...new Set(source.sourceMessageIds)].sort() })).digest('hex')
    const requestKey = createHash('sha256').update(`${turnKey}:${source.callId}:${tool.name}`).digest('hex')
    const evidence = messages.map((message) => message.text?.trim() || `[${message.type}: ${message.id}]`).join('\n').slice(0, 4000)
    const writes = ['createJob', 'saveRequirements', 'calculateQuote', 'updatePreferences', 'updateJobStatus']
    if (writes.includes(tool.name) && ['HANDOFF', 'CLOSED'].includes(conversation.status)) throw new ConflictException('La conversación está en atención humana o cerrada. No se ejecutarán acciones automáticas.')
    const ownedJob = async (id: string) => {
      const result = await this.db.job.findFirst({ where: { id, tenantId, contactProfileId: contact.id } })
      if (!result) throw new NotFoundException('Trabajo no encontrado para este cliente.')
      return result
    }

    switch (tool.name) {
      case 'findContactProfile': return { id: contact.id, name: contact.name, company: contact.company, type: contact.type, preferences: contact.preferences }
      case 'findCustomer': return contact.customerId ? this.db.customer.findFirst({ where: { id: contact.customerId, tenantId },
        select: { id: true, name: true, company: true, phone: true } }) : null
      case 'findJobs': return (await this.commercial.findJobs(contact.id, tool.args.includeClosed)).map((job) => ({
        id: job.id, title: job.title, status: job.status, productId: job.productId, requirementsRevision: job.requirementsRevision,
        confirmedReadyAt: job.confirmedReadyAt, deliveredAt: job.deliveredAt,
      }))
      case 'findQuote': {
        const selection = await this.commercial.resolveJob(contact.id, tool.args.jobId)
        if (selection.status !== 'RESOLVED') return { status: selection.status, candidates: selection.jobs.map((job) => ({ id: job.id, title: job.title })) }
        const job = selection.job
        if (!job.quoteId || !contact.customerId) return { status: 'NO_QUOTE', jobId: job.id }
        const quote = await this.db.quote.findFirst({ where: { id: job.quoteId, tenantId, customerId: contact.customerId },
          select: { id: true, number: true, status: true, currency: true, total: true, validUntil: true } })
        if (!quote) return { status: 'NO_QUOTE', jobId: job.id }
        const ready = quote.status === 'APPROVED' && (!quote.validUntil || quote.validUntil > new Date())
        return { jobId: job.id, quoteId: quote.id, number: quote.number, status: quote.status,
          customerVisible: ready, total: ready ? quote.total.toString() : null, currency: quote.currency, validUntil: quote.validUntil }
      }
      case 'findProduct': return this.db.product.findMany({ where: { tenantId, isActive: true,
        OR: [{ name: { contains: tool.args.query, mode: 'insensitive' } }, { slug: { contains: tool.args.query, mode: 'insensitive' } }] },
        orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 5, select: { id: true, name: true, category: true, description: true, unit: true } })
      case 'getProductConfiguration': {
        if (!await this.db.product.findFirst({ where: { id: tool.args.productId, tenantId, isActive: true } })) throw new NotFoundException('Producto no encontrado.')
        const configuration = await this.configurations.get(tool.args.productId)
        return configuration ? { status: 'CONFIGURED', version: configuration.version, rules: configuration.rules } : { status: 'RULE_NOT_CONFIGURED' }
      }
      case 'createJob': {
        // The logical job slot is stable even if the model issues a new tool-call ID on retry.
        const originKey = `${turnKey}:job:${tool.args.requestSlot}`
        return this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversation.id}::uuid AND "tenantId" = ${tenantId}::uuid FOR UPDATE`
          const current = await tx.conversation.findFirst({ where: { id: conversation.id, tenantId } })
          if (!current || ['HANDOFF', 'CLOSED'].includes(current.status)) throw new ConflictException('La conversación cambió y necesita revisión.')
          const prior = await tx.job.findUnique({ where: { tenantId_originKey: { tenantId, originKey } } })
          if (prior) {
            if (prior.title !== tool.args.title || prior.contactProfileId !== contact.id || prior.conversationId !== conversation.id) throw new ConflictException('La solicitud ya creó un trabajo con otros datos.')
            return { jobId: prior.id, requirementsRevision: prior.requirementsRevision, created: false }
          }
          const job = await tx.job.create({ data: { tenantId, contactProfileId: contact.id, conversationId: conversation.id, originKey, title: tool.args.title } })
          await tx.auditLog.create({ data: { tenantId, action: 'JOB_CREATED_FROM_MESSAGES', entityType: 'Job', entityId: job.id,
            details: { actorId: actor.id, sourceMessageIds: source.sourceMessageIds, originKey } } })
          return { jobId: job.id, requirementsRevision: job.requirementsRevision, created: true }
        })
      }
      case 'saveRequirements':
        await ownedJob(tool.args.jobId)
        return this.quotes.saveRequirements({ ...tool.args, requestKey, evidence }, actor)
      case 'calculateQuote':
        await ownedJob(tool.args.jobId)
        return this.quotes.createDraft({ ...tool.args, requestKey, evidence }, actor)
      case 'updatePreferences': return this.commercial.updatePreferences(contact.id, tool.args)
      case 'updateJobStatus': {
        await ownedJob(tool.args.jobId)
        // Permission comes from the inbound channel identity, not words such as “soy el dueño”.
        const result = await this.commercial.applyJobEvent(tool.args.jobId, { eventKey: requestKey, type: tool.args.event,
          evidence, amount: tool.args.amount, quoteId: tool.args.quoteId }, actor)
        return { jobId: result.id, status: result.status, confirmedReadyAt: result.confirmedReadyAt }
      }
    }
  }
}
