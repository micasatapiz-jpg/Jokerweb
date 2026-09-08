import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { Prisma, type JobStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { activePriceRuleWhere } from '../pricing/active-price-rule.js'
import { calculateDeterministicPrice } from '../pricing/pricing.calculator.js'
import { actorSchema, type TrustedActor } from './job-state.js'
import { evaluateProductRules, productConfigurationSchema } from './product-configuration.schema.js'
import { resolveQuoteInputs } from './quote-inputs.js'

const json = (value: unknown) => value as Prisma.InputJsonValue
const operationSchema = z.object({
  jobId: z.uuid(), expectedRevision: z.number().int().nonnegative(),
  requestKey: z.string().min(1).max(100), evidence: z.string().trim().min(1).max(4000),
}).strict()
const requirementsSchema = operationSchema.extend({
  productId: z.uuid(),
  values: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/).refine((key) => !['constructor', 'prototype', '__proto__'].includes(key)),
    z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()])).refine((value) => Object.keys(value).length <= 60),
}).strict()

export const quoteWorkflowSnapshotSchema = z.object({
  jobId: z.uuid(), requirementsRevision: z.number().int().nonnegative(),
  productId: z.uuid(), configurationId: z.uuid(), configurationVersion: z.number().int().positive(),
  priceRuleId: z.uuid(), priceRuleUpdatedAt: z.iso.datetime(),
}).passthrough()

type DraftResult = { status: 'PENDING_APPROVAL'; quoteId: string; approvalId: string } |
  { status: 'RULE_NOT_CONFIGURED' | 'MISSING_DATA' | 'CUSTOMER_DETAILS_REQUIRED'; taskId: string; missingFields: string[] }
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value
export const quoteSnapshotDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')

@Injectable()
export class QuoteWorkflowService {
  constructor(private readonly db: PrismaService, private readonly tenant: LocalTenantService) {}
  private get tenantId() { return this.tenant.tenantId }

  private async lockJob(tx: Prisma.TransactionClient, id: string, actor: TrustedActor) {
    actorSchema.parse(actor)
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${id}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR UPDATE`
    const job = await tx.job.findFirst({ where: { id, tenantId: this.tenantId } })
    if (!job) throw new NotFoundException('Trabajo no encontrado.')
    if (actor.role === 'CUSTOMER' && actor.contactProfileId !== job.contactProfileId) throw new ForbiddenException('El trabajo no corresponde al cliente.')
    return job
  }

  private async replay(tx: Prisma.TransactionClient, jobId: string, key: string, request: unknown, actor: TrustedActor) {
    const event = await tx.jobEvent.findUnique({ where: { tenantId_eventKey: { tenantId: this.tenantId, eventKey: key } } })
    if (!event) return null
    const payload = event.payload as { request: unknown; result: unknown }
    if (event.jobId !== jobId || event.actorId !== actor.id || event.actorRole !== actor.role || !isDeepStrictEqual(payload.request, request)) throw new ConflictException('La clave ya se utilizó para otra operación.')
    return payload.result
  }

  private async record(tx: Prisma.TransactionClient, job: { id: string; status: JobStatus }, key: string, type: string,
    evidence: string, request: unknown, result: unknown, status: JobStatus, actor: TrustedActor) {
    await tx.jobEvent.create({ data: { tenantId: this.tenantId, jobId: job.id, eventKey: key, type, evidence,
      actorId: actor.id, actorRole: actor.role, fromStatus: job.status, toStatus: status, payload: json({ request, result }) } })
    await tx.auditLog.create({ data: { tenantId: this.tenantId, action: type, entityType: 'Job', entityId: job.id,
      details: { actorId: actor.id, eventKey: key, result: json(result) } } })
  }

  // Explicitly confirmed requirements only. Adapters must clarify units/which job before calling.
  async saveRequirements(input: unknown, actor: TrustedActor) {
    const data = requirementsSchema.parse(input)
    const key = `requirements:${data.requestKey}`
    return this.db.$transaction(async (tx) => {
      const job = await this.lockJob(tx, data.jobId, actor)
      const replay = await this.replay(tx, job.id, key, data, actor)
      if (replay) return replay as { jobId: string; requirementsRevision: number }
      if (job.requirementsRevision !== data.expectedRevision) throw new ConflictException('Los requisitos cambiaron. Revisa la versión actual.')
      if (['ENTREGADO', 'CANCELADO', 'REQUIERE_HUMANO', 'PAUSADO'].includes(job.status)) throw new ConflictException('Este trabajo requiere intervención humana o está cerrado.')
      const product = await tx.product.findFirst({ where: { id: data.productId, tenantId: this.tenantId, isActive: true } })
      if (!product) throw new NotFoundException('Producto no encontrado.')
      const configuration = await tx.productConfiguration.findFirst({ where: { tenantId: this.tenantId, productId: product.id }, orderBy: { version: 'desc' } })
      const parsed = productConfigurationSchema.safeParse(configuration?.rules)
      const permitted = new Set([...Object.keys(parsed.success ? parsed.data.quotationRules.fields : {}), 'location', 'designBrief', 'installationNotes', 'customerRequest'])
      if (Object.keys(data.values).some((field) => !permitted.has(field))) throw new ConflictException('Solo se pueden guardar requisitos definidos para este producto; no precios, pagos ni fechas confirmadas.')
      const values = { ...(job.productId === product.id ? job.requirements as Record<string, unknown> : {}), ...data.values }
      if (job.productId === product.id && isDeepStrictEqual(job.requirements, values)) {
        const result = { jobId: job.id, requirementsRevision: job.requirementsRevision }
        await this.record(tx, job, key, 'REQUIREMENTS_UNCHANGED', data.evidence, data, result, job.status, actor)
        return result
      }
      const revision = job.requirementsRevision + 1
      const needsReview = Boolean(job.quoteId) || ['EN_PRODUCCION', 'LISTO_PARA_RECOGER', 'FECHA_PENDIENTE'].includes(job.status)
      const status = needsReview ? 'REQUIERE_REVISION' as const : 'RECOPILANDO_DATOS' as const
      await tx.job.update({ where: { id: job.id }, data: { productId: product.id, requirements: json(values), requirementsRevision: revision,
        status, version: { increment: 1 }, artworkApprovedAt: null, confirmedReadyAt: null } })
      if (job.quoteId) {
        await tx.quote.updateMany({ where: { id: job.quoteId, tenantId: this.tenantId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } }, data: { status: 'EXPIRED' } })
        await tx.approval.updateMany({ where: { tenantId: this.tenantId, jobId: job.id, type: 'QUOTE', status: 'PENDING' },
          data: { status: 'REJECTED', reviewedAt: new Date(), reviewedBy: actor.id, reviewNote: 'Los requisitos cambiaron; requiere un nuevo presupuesto.' } })
      }
      if (needsReview) await tx.task.create({ data: { tenantId: this.tenantId, jobId: job.id, conversationId: job.conversationId,
        type: 'CHECK_REQUIREMENT', title: 'Revisar cambio de requisitos, presupuesto y fecha', dedupeKey: key, details: json({ previousRevision: job.requirementsRevision, revision, evidence: data.evidence }) } })
      const result = { jobId: job.id, requirementsRevision: revision }
      await this.record(tx, job, key, 'REQUIREMENTS_SAVED', data.evidence, data, result, status, actor)
      return result
    })
  }

  async createDraft(input: unknown, actor: TrustedActor): Promise<DraftResult> {
    const data = operationSchema.parse(input)
    const key = `quote-draft:${data.requestKey}`
    return this.db.$transaction(async (tx) => {
      const job = await this.lockJob(tx, data.jobId, actor)
      const replay = await this.replay(tx, job.id, key, data, actor)
      if (replay) return replay as DraftResult
      if (job.requirementsRevision !== data.expectedRevision) throw new ConflictException('Los requisitos cambiaron. Vuelve a calcular con la versión actual.')
      if (!['NUEVO', 'CONSULTANDO', 'RECOPILANDO_DATOS', 'LISTO_PARA_COTIZAR', 'REQUIERE_REVISION'].includes(job.status)) throw new ConflictException('El estado del trabajo no permite crear otro presupuesto.')
      if (job.quoteId) {
        const existing = await tx.quote.findFirst({ where: { id: job.quoteId, tenantId: this.tenantId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } } })
        if (existing) throw new ConflictException('El trabajo ya tiene un presupuesto vigente. Revísalo o recházalo antes de generar otro.')
      }

      const escalate = async (status: 'RULE_NOT_CONFIGURED' | 'MISSING_DATA' | 'CUSTOMER_DETAILS_REQUIRED', missingFields: string[], reason: string): Promise<DraftResult> => {
        const task = await tx.task.create({ data: { tenantId: this.tenantId, jobId: job.id, conversationId: job.conversationId,
          type: status === 'RULE_NOT_CONFIGURED' ? 'CHECK_PRODUCT_RULE' : 'CHECK_REQUIREMENT', dedupeKey: key,
          title: 'Completar información antes de cotizar', details: { status, reason, missingFields, productId: job.productId } } })
        await tx.job.update({ where: { id: job.id }, data: { status: 'REQUIERE_REVISION', version: { increment: 1 } } })
        const result = { status, taskId: task.id, missingFields }
        await this.record(tx, job, key, 'QUOTE_REVIEW_REQUIRED', data.evidence, data, result, 'REQUIERE_REVISION', actor)
        return result
      }

      const product = job.productId ? await tx.product.findFirst({ where: { id: job.productId, tenantId: this.tenantId, isActive: true } }) : null
      if (!product) return escalate('RULE_NOT_CONFIGURED', [], 'Falta un producto activo seleccionado.')
      // Same lock order as configuration publishing, so the snapshot cannot straddle a new version.
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${product.id}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR UPDATE`
      const configuration = await tx.productConfiguration.findFirst({ where: { tenantId: this.tenantId, productId: product.id }, orderBy: { version: 'desc' } })
      const parsed = productConfigurationSchema.safeParse(configuration?.rules)
      if (!configuration || !parsed.success) return escalate('RULE_NOT_CONFIGURED', [], 'Faltan reglas aprobadas válidas.')
      const rules = parsed.data
      const requirements = job.requirements as Record<string, unknown>
      const evaluation = evaluateProductRules(rules, requirements)
      if (evaluation.status === 'MISSING_DATA') return escalate('MISSING_DATA', evaluation.missingFields, 'Faltan requisitos del producto.')
      if (!rules.quotationRules.pricingEngine || !rules.quotationRules.pricingInputs || !rules.quotationRules.validityDays) return escalate('RULE_NOT_CONFIGURED', [], 'Falta motor, mapeo de unidades/servicios o vigencia del presupuesto.')
      const resolved = resolveQuoteInputs(product.id, rules.quotationRules.pricingInputs, requirements)
      if (resolved.status !== 'READY') return escalate('MISSING_DATA', resolved.missingFields, 'Faltan datos explícitos para el cálculo.')
      if (rules.quotationRules.requiresDesign === true && !resolved.input.includeDesign) return escalate('RULE_NOT_CONFIGURED', [], 'El mapeo de diseño contradice la regla del producto.')
      if (rules.installationRules.requiresInstallation === true && !resolved.input.installationRequired) return escalate('RULE_NOT_CONFIGURED', [], 'El mapeo de instalación contradice la regla del producto.')
      const now = new Date()
      const rate = await tx.priceRule.findFirst({ where: { ...activePriceRuleWhere(this.tenantId, now), productId: product.id }, orderBy: [{ validFrom: 'desc' }, { id: 'asc' }] })
      if (!rate) return escalate('RULE_NOT_CONFIGURED', [], 'No hay tarifa real vigente. No usar precios demo.')
      if (Number(rate.pricePerSquareMeter) > 0 && (!resolved.input.widthM || !resolved.input.heightM)) return escalate('RULE_NOT_CONFIGURED', [], 'La tarifa por área necesita dimensiones en metros.')
      const rateSnapshot = { basePrice: Number(rate.basePrice), pricePerSquareMeter: Number(rate.pricePerSquareMeter), designFee: Number(rate.designFee),
        installationFee: Number(rate.installationFee), transportFee: Number(rate.transportFee), marginPercent: Number(rate.marginPercent), igvPercent: Number(rate.igvPercent) }
      const calculated = calculateDeterministicPrice(resolved.input, rateSnapshot)
      if (calculated.total <= 0 || (calculated.areaM2 ?? 0) >= 100000000 || [calculated.total, calculated.subtotal, calculated.unitPrice, calculated.tax].some((amount) => !Number.isFinite(amount) || amount >= 10000000000)) return escalate('RULE_NOT_CONFIGURED', [], 'La tarifa produce un importe o área fuera del rango admitido para una cotización comercial.')
      await tx.$queryRaw`SELECT id FROM "ContactProfile" WHERE id = ${job.contactProfileId}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR UPDATE`
      const contact = await tx.contactProfile.findFirstOrThrow({ where: { id: job.contactProfileId, tenantId: this.tenantId } })
      if (!contact.name) return escalate('CUSTOMER_DETAILS_REQUIRED', ['name'], 'Falta el nombre del cliente para el documento.')
      let customerId = contact.customerId
      if (!customerId) {
        const customer = await tx.customer.create({ data: { tenantId: this.tenantId, name: contact.name, phone: contact.phone, company: contact.company } })
        customerId = customer.id
        await tx.contactProfile.update({ where: { id: contact.id }, data: { customerId } })
      }
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: this.tenantId } })
      const snapshot = { jobId: job.id, requirementsRevision: job.requirementsRevision, productId: product.id,
        configurationId: configuration.id, configurationVersion: configuration.version,
        priceRuleId: rate.id, priceRuleUpdatedAt: rate.updatedAt.toISOString(), rate: rateSnapshot,
        requirements, calculationInput: resolved.input, calculation: calculated }
      const quote = await tx.quote.create({ data: { tenantId: this.tenantId, customerId,
        number: `COT-${now.getUTCFullYear()}-${randomUUID()}`, status: 'PENDING_APPROVAL', currency: tenant.currency,
        sourceText: data.evidence, serviceAddress: typeof requirements.location === 'string' ? requirements.location : null,
        designBrief: typeof requirements.designBrief === 'string' ? requirements.designBrief : null,
        installationNotes: typeof requirements.installationNotes === 'string' ? requirements.installationNotes : null,
        subtotal: calculated.subtotal, discount: calculated.discount, tax: calculated.tax, total: calculated.total,
        validUntil: new Date(now.getTime() + rules.quotationRules.validityDays * 86400000), workflowSnapshot: json(snapshot),
        items: { create: { productId: product.id, priceRuleId: rate.id, description: product.name, quantity: calculated.quantity,
          widthM: resolved.input.widthM, heightM: resolved.input.heightM, areaM2: calculated.areaM2, unitPrice: calculated.unitPrice,
          subtotal: calculated.subtotal, pricingBreakdown: json({ ...calculated, priceRuleName: rate.name, priceRuleWasDemo: false, rateSnapshot }) } },
      } })
      const approval = await tx.approval.create({ data: { tenantId: this.tenantId, jobId: job.id, type: 'QUOTE', dedupeKey: key,
        payload: { quoteId: quote.id, requirementsRevision: job.requirementsRevision, snapshotDigest: quoteSnapshotDigest(snapshot), total: quote.total.toString(), currency: quote.currency } } })
      await tx.task.create({ data: { tenantId: this.tenantId, jobId: job.id, conversationId: job.conversationId, type: 'APPROVE_QUOTE',
        title: `Revisar cotización ${quote.number}`, dedupeKey: key, details: { quoteId: quote.id, approvalId: approval.id } } })
      // No customer message/PDF is emitted here. Only reviewed budgets may be delivered.
      await tx.job.update({ where: { id: job.id }, data: { quoteId: quote.id, status: 'REQUIERE_REVISION', version: { increment: 1 } } })
      const result: DraftResult = { status: 'PENDING_APPROVAL', quoteId: quote.id, approvalId: approval.id }
      await this.record(tx, job, key, 'QUOTE_DRAFT_CREATED', data.evidence, data, result, 'REQUIERE_REVISION', actor)
      return result
    })
  }

  async reviewQuote(input: unknown, actor: TrustedActor) {
    actorSchema.parse(actor)
    if (actor.role !== 'OWNER') throw new ForbiddenException('La revisión de cotizaciones requiere al dueño autorizado.')
    const data = z.object({ jobId: z.uuid(), approvalId: z.uuid(), decision: z.enum(['APPROVED', 'REJECTED']),
      note: z.string().trim().min(1).max(4000) }).strict().parse(input)
    return this.db.$transaction(async (tx) => {
      const job = await this.lockJob(tx, data.jobId, actor)
      const approval = await tx.approval.findFirst({ where: { id: data.approvalId, tenantId: this.tenantId, jobId: job.id, type: 'QUOTE' } })
      if (!approval) throw new NotFoundException('Aprobación no encontrada para este trabajo.')
      const payload = approval.payload as { quoteId: string; snapshotDigest: string; total: string; currency: string }
      const quote = await tx.quote.findFirst({ where: { id: payload.quoteId, tenantId: this.tenantId } })
      if (!quote) throw new NotFoundException('Cotización no encontrada.')
      if (approval.status !== 'PENDING') {
        if (approval.status === data.decision && approval.reviewedBy === actor.id && approval.reviewNote === data.note) return quote
        throw new ConflictException('Esta aprobación ya fue revisada.')
      }
      if (job.quoteId !== quote.id || quote.status !== 'PENDING_APPROVAL') throw new ConflictException('La cotización ya no es el borrador vigente del trabajo.')
      if (!['REQUIERE_REVISION', 'LISTO_PARA_COTIZAR'].includes(job.status)) throw new ConflictException('El trabajo no está disponible para revisar el presupuesto.')
      const snapshot = quoteWorkflowSnapshotSchema.parse(quote.workflowSnapshot)
      if (snapshot.jobId !== job.id || snapshot.requirementsRevision !== job.requirementsRevision || snapshot.productId !== job.productId) throw new ConflictException('Los requisitos cambiaron. Se necesita un nuevo presupuesto.')
      if (payload.snapshotDigest !== quoteSnapshotDigest(quote.workflowSnapshot)) throw new ConflictException('El cálculo cambió después de solicitar aprobación.')
      if (payload.total !== quote.total.toString() || payload.currency !== quote.currency) throw new ConflictException('El importe cambió después de solicitar aprobación.')
      if (data.decision === 'APPROVED') {
        if (!quote.validUntil || quote.validUntil <= new Date()) throw new ConflictException('La cotización está vencida.')
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${snapshot.productId}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM "PriceRule" WHERE id = ${snapshot.priceRuleId}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR SHARE`
        if (!await tx.product.findFirst({ where: { id: snapshot.productId, tenantId: this.tenantId, isActive: true } })) throw new ConflictException('El producto ya no está activo.')
        const config = await tx.productConfiguration.findFirst({ where: { tenantId: this.tenantId, productId: snapshot.productId }, orderBy: { version: 'desc' } })
        const rate = await tx.priceRule.findFirst({ where: { ...activePriceRuleWhere(this.tenantId, new Date()), id: snapshot.priceRuleId, productId: snapshot.productId } })
        if (!config || config.id !== snapshot.configurationId || config.version !== snapshot.configurationVersion || !rate || rate.updatedAt.toISOString() !== snapshot.priceRuleUpdatedAt) throw new ConflictException('Las reglas o tarifas cambiaron; vuelve a calcular antes de aprobar.')
      }
      const now = new Date()
      await tx.approval.update({ where: { id: approval.id }, data: { status: data.decision, reviewedBy: actor.id, reviewedAt: now, reviewNote: data.note } })
      const updated = await tx.quote.update({ where: { id: quote.id }, data: { status: data.decision, approvedAt: data.decision === 'APPROVED' ? now : null } })
      await tx.task.updateMany({ where: { tenantId: this.tenantId, dedupeKey: approval.dedupeKey, type: 'APPROVE_QUOTE', status: { in: ['OPEN', 'IN_PROGRESS'] } }, data: { status: 'DONE', completedAt: now } })
      await this.record(tx, job, `quote-review:${approval.id}`, `QUOTE_${data.decision}`, data.note, data, { quoteId: quote.id, approvalId: approval.id }, job.status, actor)
      return updated
    })
  }
}
