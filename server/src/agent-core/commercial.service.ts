import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { contactInputSchema, createApprovalSchema, createJobSchema, createTaskSchema, preferencesSchema, summaryInputSchema } from './commercial.schemas.js'
import { jobEventSchema, transitionJob, type TrustedActor } from './job-state.js'
import { quoteWorkflowSnapshotSchema } from './quote-workflow.service.js'

const json = (value: unknown) => value as Prisma.InputJsonValue

@Injectable()
export class CommercialService {
  constructor(private readonly db: PrismaService, private readonly tenant: LocalTenantService) {}
  private get tenantId() { return this.tenant.tenantId }

  async findContactProfile(phone: string) {
    const parsed = contactInputSchema.parse({ phone })
    return this.db.contactProfile.findUnique({ where: { tenantId_phone: { tenantId: this.tenantId, phone: parsed.phone } } })
  }

  async ensureContact(input: unknown) {
    const data = contactInputSchema.parse(input)
    const contact = await this.db.contactProfile.upsert({
      where: { tenantId_phone: { tenantId: this.tenantId, phone: data.phone } },
      create: { ...data, tenantId: this.tenantId }, update: { name: data.name, company: data.company },
    })
    return { ...contact, phone:data.phone }
  }

  async updatePreferences(id: string, input: unknown) {
    const patch = preferencesSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      // Lock the profile to avoid losing a concurrent memory update.
      await tx.$queryRaw`SELECT id FROM "ContactProfile" WHERE id = ${id}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR UPDATE`
      const profile = await tx.contactProfile.findFirst({ where: { id, tenantId: this.tenantId } })
      if (!profile) throw new NotFoundException('Contacto no encontrado.')
      return tx.contactProfile.update({ where: { id }, data: { preferences: json({ ...(profile.preferences as object), ...patch }) } })
    })
  }

  async createJob(input: unknown) {
    const data = createJobSchema.parse(input)
    const contact = await this.db.contactProfile.findFirst({ where: { id: data.contactProfileId, tenantId: this.tenantId } })
    if (!contact) throw new NotFoundException('Contacto no encontrado.')
    if (data.conversationId) {
      const conversation = await this.db.conversation.findFirst({ where: { id: data.conversationId, tenantId: this.tenantId } })
      if (!conversation || conversation.customerPhone?.replace(/^\+/, '') !== contact.phone) throw new ConflictException('El chat no corresponde a este contacto.')
    }
    return this.db.job.create({ data: { ...data, tenantId: this.tenantId } })
  }

  findJobs(contactProfileId: string, includeClosed = false) {
    return this.db.job.findMany({ where: { tenantId: this.tenantId, contactProfileId,
      ...(includeClosed ? {} : { status: { notIn: ['ENTREGADO', 'CANCELADO'] } }) }, orderBy: { updatedAt: 'desc' }, take: 50 })
  }

  async resolveJob(contactProfileId: string, explicitJobId?: string) {
    if (explicitJobId) {
      const job = await this.db.job.findFirst({ where: { id: explicitJobId, contactProfileId, tenantId: this.tenantId } })
      if (!job) throw new NotFoundException('Trabajo no encontrado para este contacto.')
      return { status: 'RESOLVED' as const, job }
    }
    const jobs = await this.findJobs(contactProfileId)
    if (jobs.length === 1) return { status: 'RESOLVED' as const, job: jobs[0] }
    return { status: jobs.length ? 'AMBIGUOUS' as const : 'NO_ACTIVE_JOB' as const, jobs }
  }

  async createTask(input: unknown) {
    const data = createTaskSchema.parse(input)
    if (data.jobId && !await this.db.job.findFirst({ where: { id: data.jobId, tenantId: this.tenantId } })) throw new NotFoundException('Trabajo no encontrado.')
    if (data.conversationId && !await this.db.conversation.findFirst({ where: { id: data.conversationId, tenantId: this.tenantId } })) throw new NotFoundException('Chat no encontrado.')
    const result = await this.db.task.upsert({ where: { tenantId_dedupeKey: { tenantId: this.tenantId, dedupeKey: data.dedupeKey } },
      create: { ...data, details: json(data.details), dueAt: data.dueAt ? new Date(data.dueAt) : undefined, tenantId: this.tenantId }, update: {} })
    if (result.type !== data.type || result.jobId !== (data.jobId ?? null) || result.conversationId !== (data.conversationId ?? null)) throw new ConflictException('La clave de tarea ya corresponde a otra solicitud.')
    return result
  }

  async createApproval(input: unknown) {
    const data = createApprovalSchema.parse(input)
    if (!await this.db.job.findFirst({ where: { id: data.jobId, tenantId: this.tenantId } })) throw new NotFoundException('Trabajo no encontrado.')
    const result = await this.db.approval.upsert({ where: { tenantId_dedupeKey: { tenantId: this.tenantId, dedupeKey: data.dedupeKey } },
      create: { ...data, payload: json(data.payload), tenantId: this.tenantId }, update: {} })
    if (result.type !== data.type || result.jobId !== data.jobId || !isDeepStrictEqual(result.payload, data.payload)) throw new ConflictException('La clave de aprobación ya corresponde a otra solicitud.')
    return result
  }

  // Internal only: HTTP/WhatsApp adapters must resolve actor identity from an authenticated session/operator.
  async reviewApproval(id: string, decision: 'APPROVED' | 'REJECTED', note: string, actor: TrustedActor) {
    if (actor.role !== 'OWNER' || !actor.id || !['APPROVED', 'REJECTED'].includes(decision) || !note.trim()) throw new ForbiddenException('Se requiere revisión explícita del dueño.')
    return this.db.$transaction(async (tx) => {
      const pending = await tx.approval.findFirst({ where: { id, tenantId: this.tenantId } })
      if (pending?.type === 'QUOTE') throw new ConflictException('Las cotizaciones deben revisarse mediante el flujo de presupuesto que valida requisitos y tarifas.')
      const updated = await tx.approval.updateMany({ where: { id, tenantId: this.tenantId, status: 'PENDING' },
        data: { status: decision, reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note.slice(0, 4000) } })
      if (updated.count !== 1) throw new ConflictException('Aprobación inexistente o ya revisada.')
      await tx.auditLog.create({ data: { tenantId: this.tenantId, action: `APPROVAL_${decision}`, entityType: 'Approval', entityId: id, details: { actorId: actor.id, note } } })
      return tx.approval.findUniqueOrThrow({ where: { id } })
    })
  }

  async applyJobEvent(jobId: string, input: unknown, actor: TrustedActor) {
    const event = jobEventSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const job = await tx.job.findFirst({ where: { id: jobId, tenantId: this.tenantId } })
      if (!job) throw new NotFoundException('Trabajo no encontrado.')
      if (actor.role === 'CUSTOMER' && actor.contactProfileId !== job.contactProfileId) throw new ForbiddenException('El trabajo no corresponde al cliente.')
      const prior = await tx.jobEvent.findUnique({ where: { tenantId_eventKey: { tenantId: this.tenantId, eventKey: event.eventKey } } })
      if (prior) {
        if (prior.jobId !== jobId || prior.actorId !== actor.id || prior.actorRole !== actor.role || !isDeepStrictEqual(prior.payload, event)) throw new ConflictException('Evento duplicado con contenido diferente.')
        return job
      }
      const next = transitionJob(job.status, event, actor)
      if (event.type === 'CUSTOMER_ACCEPTED' || event.type === 'QUOTE_ISSUED') {
        if (event.type === 'CUSTOMER_ACCEPTED' && event.quoteId && event.quoteId !== job.quoteId) throw new ConflictException('La aceptación debe corresponder a la cotización del trabajo.')
        const quoteId = event.quoteId ?? job.quoteId
        if (!quoteId) throw new ConflictException('El trabajo todavía no tiene una cotización aprobada.')
        const quote = await tx.quote.findFirst({ where: { id: quoteId, tenantId: this.tenantId, status: 'APPROVED' } })
        const contact = await tx.contactProfile.findUniqueOrThrow({ where: { id: job.contactProfileId } })
        if (!quote || !contact.customerId || quote.customerId !== contact.customerId || (quote.validUntil && quote.validUntil <= new Date())) throw new ConflictException('Cotización no aprobada, vencida o de otro cliente.')
        if (quote.workflowSnapshot) {
          const snapshot = quoteWorkflowSnapshotSchema.parse(quote.workflowSnapshot)
          if (snapshot.jobId !== jobId || snapshot.productId !== job.productId || snapshot.requirementsRevision !== job.requirementsRevision) throw new ConflictException('La cotización no corresponde a los requisitos vigentes del trabajo.')
        }
      }
      if (event.type === 'PAYMENT_CONFIRMED' || event.type === 'SET_DELIVERY_DATE') {
        const approval = await tx.approval.findFirst({ where: { id: event.approvalId, tenantId: this.tenantId, jobId,
          type: event.type === 'PAYMENT_CONFIRMED' ? 'PAYMENT' : 'DELIVERY_DATE', status: 'APPROVED' } })
        if (!approval) throw new ConflictException('Falta una aprobación válida para este trabajo.')
        const payload = approval.payload as { readyAt?: string; amount?: number }
        if (event.type === 'SET_DELIVERY_DATE' && payload.readyAt !== event.readyAt) throw new ConflictException('La fecha no coincide con la aprobación.')
        if (event.type === 'PAYMENT_CONFIRMED' && (!event.amount || payload.amount !== event.amount)) throw new ConflictException('El monto no coincide con la aprobación.')
      }
      // Enabled only after production gates are supplied by ProductConfiguration (phase 10).
      if (event.type === 'START_PRODUCTION') throw new ConflictException('Las reglas de producción todavía requieren configuración y revisión.')
      const changed = await tx.job.updateMany({ where: { id: jobId, tenantId: this.tenantId, version: job.version }, data: {
        status: next.status, version: { increment: 1 }, confirmedReadyAt: event.type === 'REQUIREMENTS_CHANGED' ? null : next.readyAt,
        deliveredAt: next.delivered ? new Date() : undefined,
        artworkApprovedAt: event.type === 'REQUIREMENTS_CHANGED' ? null : next.artworkApproved ? new Date() : undefined,
        requirementsRevision: event.type === 'REQUIREMENTS_CHANGED' ? { increment: 1 } : undefined,
        quoteId: event.type === 'QUOTE_ISSUED' ? event.quoteId : undefined,
      } })
      if (changed.count !== 1) throw new ConflictException('El trabajo cambió. Revisa la versión actual antes de repetir.')
      if (event.type === 'REQUIREMENTS_CHANGED' && job.quoteId) {
        await tx.quote.updateMany({ where: { id: job.quoteId, tenantId: this.tenantId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } }, data: { status: 'EXPIRED' } })
        await tx.approval.updateMany({ where: { tenantId: this.tenantId, jobId, type: 'QUOTE', status: 'PENDING' },
          data: { status: 'REJECTED', reviewedAt: new Date(), reviewedBy: actor.id, reviewNote: 'Los requisitos cambiaron; se necesita una nueva cotización.' } })
      }
      await tx.jobEvent.create({ data: { tenantId: this.tenantId, jobId, eventKey: event.eventKey, type: event.type,
        actorId: actor.id, actorRole: actor.role, evidence: event.evidence, fromStatus: job.status, toStatus: next.status, payload: json(event) } })
      if (next.task) await tx.task.create({ data: { tenantId: this.tenantId, jobId, conversationId: job.conversationId,
        type: next.task, title: event.evidence.slice(0, 200), details: json(event), dedupeKey: `event:${event.eventKey}` } })
      if (job.conversationId && ['REQUEST_HUMAN', 'COMPLAINT'].includes(event.type)) {
        await tx.conversation.updateMany({ where: { id: job.conversationId, tenantId: this.tenantId }, data: { status: 'HANDOFF' } })
      }
      await tx.auditLog.create({ data: { tenantId: this.tenantId, action: event.type, entityType: 'Job', entityId: jobId,
        details: { actorId: actor.id, fromStatus: job.status, toStatus: next.status, eventKey: event.eventKey } } })
      return tx.job.findUniqueOrThrow({ where: { id: jobId } })
    })
  }

  async saveSummary(input: unknown) {
    const data = summaryInputSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${data.conversationId}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR UPDATE`
      const conversation = await tx.conversation.findFirst({ where: { id: data.conversationId, tenantId: this.tenantId } })
      const contact = await tx.contactProfile.findFirst({ where: { id: data.contactProfileId, tenantId: this.tenantId } })
      if (!conversation || !contact || conversation.customerPhone?.replace(/^\+/, '') !== contact.phone) throw new ConflictException('El resumen no corresponde al contacto y chat.')
      const count = await tx.conversationMessage.count({ where: { conversationId: data.conversationId, id: { in: data.sourceMessageIds } } })
      if (count !== new Set(data.sourceMessageIds).size) throw new ConflictException('El resumen contiene fuentes ajenas al chat.')
      const last = await tx.conversationSummary.findFirst({ where: { tenantId: this.tenantId, conversationId: data.conversationId }, orderBy: { version: 'desc' } })
      return tx.conversationSummary.create({ data: { ...data, tenantId: this.tenantId, sourceMessageIds: data.sourceMessageIds, version: (last?.version ?? 0) + 1 } })
    })
  }
}
