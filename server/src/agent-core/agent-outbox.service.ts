import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma, type AgentOutbox } from '../generated/prisma/client.js'
import { PrismaService } from '../database/prisma.service.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { maySendAutomatically, hasPermission, permissionSchema } from './actor-policy.js'

const handleSchema = z.object({ outboxId: z.uuid(), leaseOwner: z.uuid() }).strict()
export type OutboxHandle = z.infer<typeof handleSchema>

export function outboxDisposition(row: Pick<AgentOutbox, 'status' | 'leaseUntil'>, now = new Date()) {
  if (row.status === 'SENDING') return !row.leaseUntil || row.leaseUntil <= now ? 'UNCERTAIN' as const : 'BUSY' as const
  if (row.status === 'FAILED' || row.status === 'UNCERTAIN') return 'REQUIRES_REVIEW' as const
  if (row.status === 'PENDING') return 'SEND' as const
  return 'TERMINAL' as const
}

// Transport-independent outbox; there are no model/Meta calls in a DB transaction.
// A channel adapter must report a positive provider acknowledgement to acknowledge().
@Injectable()
export class AgentOutboxService {
  constructor(private readonly db: PrismaService, private readonly tenant: LocalTenantService) {}
  private get tenantId() { return this.tenant.tenantId }

  async claimNext(conversationId: string) {
    z.uuid().parse(conversationId)
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR UPDATE`
      const conversation = await tx.conversation.findFirst({ where: { id: conversationId, tenantId: this.tenantId } })
      if (!conversation) throw new NotFoundException('Conversación no encontrada.')
      const row = await tx.agentOutbox.findFirst({ where: { tenantId: this.tenantId, conversationId, status: { notIn: ['SENT', 'CANCELLED'] } },
        orderBy: [{ createdAt: 'asc' }, { sequence: 'asc' }, { id: 'asc' }] })
      if (!row) return { status: 'EMPTY' as const }
      const disposition = outboxDisposition(row)
      const authorization = row.payload as { actorId?:string; requiredPermission?:string }
      if (disposition === 'SEND' && authorization.requiredPermission) {
        const permission = permissionSchema.safeParse(authorization.requiredPermission)
        const actor = authorization.actorId ? await tx.actorIdentity.findFirst({ where:{ id:authorization.actorId,tenantId:this.tenantId,active:true } }) : null
        if (!permission.success || !hasPermission(actor,permission.data)) {
          await tx.agentOutbox.update({ where:{ id:row.id },data:{ status:'CANCELLED' } })
          return { status:'CANCELLED' as const }
        }
      }
      if (disposition === 'SEND' && !maySendAutomatically(conversation,(row.payload as Record<string, unknown>)?.internalReply === true)) {
        await tx.agentOutbox.update({ where:{ id:row.id },data:{ status:'CANCELLED' } })
        return { status:'PAUSED' as const }
      }
      if (disposition === 'UNCERTAIN') {
        await tx.agentOutbox.update({ where: { id: row.id }, data: { status: 'UNCERTAIN' } })
        await this.reviewTask(tx, row, 'PROCESS_INTERRUPTED_DURING_SEND')
        return { status: 'REQUIRES_REVIEW' as const }
      }
      if (disposition !== 'SEND') return { status: disposition }
      const payload = row.payload as { handoffAcknowledgement?: boolean }
      if (conversation.status === 'CLOSED' || (conversation.status === 'HANDOFF' && payload.handoffAcknowledgement !== true)) {
        await tx.agentOutbox.update({ where: { id: row.id }, data: { status: 'CANCELLED' } })
        return { status: 'CANCELLED' as const }
      }
      const leaseOwner = randomUUID()
      await tx.agentOutbox.update({ where: { id: row.id }, data: { status: 'SENDING', leaseOwner, leaseUntil: new Date(Date.now() + 90000) } })
      return { status: 'CLAIMED' as const, handle: { outboxId: row.id, leaseOwner }, type: row.type,
        payload: row.payload, conversationId: conversation.id, externalId: conversation.externalId }
    })
  }

  private async withAttempt<T>(rawHandle: OutboxHandle, callback: (tx: Prisma.TransactionClient, row: AgentOutbox) => Promise<T>) {
    const handle = handleSchema.parse(rawHandle)
    return this.db.$transaction(async (tx) => {
      const initial = await tx.agentOutbox.findFirst({ where: { id: handle.outboxId, tenantId: this.tenantId } })
      if (!initial) throw new NotFoundException('Envío no encontrado.')
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${initial.conversationId}::uuid AND "tenantId" = ${this.tenantId}::uuid FOR UPDATE`
      const row = await tx.agentOutbox.findFirstOrThrow({ where: { id: initial.id, tenantId: this.tenantId } })
      if (row.leaseOwner !== handle.leaseOwner) throw new ConflictException('La confirmación no corresponde a este intento de envío.')
      return callback(tx, row)
    })
  }

  acknowledge(handle: OutboxHandle, externalMessageId: string) {
    externalMessageId = z.string().trim().min(1).max(500).parse(externalMessageId)
    return this.withAttempt(handle, async (tx, row) => {
      if (row.status === 'SENT') {
        if (row.externalMessageId !== externalMessageId) throw new ConflictException('El envío ya tiene otro identificador confirmado.')
        return row
      }
      // A late positive acknowledgement can resolve an uncertain attempt without another send.
      if (!['SENDING', 'UNCERTAIN'].includes(row.status)) throw new ConflictException('El intento ya no admite confirmación.')
      const existing = await tx.conversationMessage.findUnique({ where: { conversationId_externalMessageId: { conversationId: row.conversationId, externalMessageId } } })
      const text = typeof (row.payload as { text?: unknown }).text === 'string' ? (row.payload as { text: string }).text : null
      if (existing && (existing.direction !== 'OUTBOUND' || existing.type !== row.type || existing.text !== text ||
        ((existing.payload as { outboxId?: string } | null)?.outboxId && (existing.payload as { outboxId: string }).outboxId !== row.id))) throw new ConflictException('El identificador externo corresponde a otro mensaje.')
      const updated = await tx.agentOutbox.update({ where: { id: row.id }, data: { status: 'SENT', externalMessageId, sentAt: new Date() } })
      await tx.conversationMessage.upsert({ where: { conversationId_externalMessageId: { conversationId: row.conversationId, externalMessageId } },
        create: { conversationId: row.conversationId, externalMessageId, direction: 'OUTBOUND', type: row.type, status: 'SENT', authorType:'AI_AGENT', source:'AGENT_OUTBOX',
          text,
          payload: { outboxId: row.id, turnId: row.turnId } }, update: {} })
      await tx.task.updateMany({ where: { tenantId: this.tenantId, dedupeKey: `outbox-review:${row.id}`, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        data: { status: 'DONE', completedAt: new Date() } })
      await tx.auditLog.create({ data: { tenantId: this.tenantId, action: 'AGENT_OUTBOX_ACKNOWLEDGED', entityType: 'AgentOutbox', entityId: row.id,
        details: { externalMessageId, resolvedUncertainty: row.status === 'UNCERTAIN' } } })
      return updated
    })
  }

  uncertain(handle: OutboxHandle) {
    return this.withAttempt(handle, async (tx, row) => {
      if (row.status === 'SENT') return row
      if (!['SENDING', 'UNCERTAIN'].includes(row.status)) throw new ConflictException('El envío ya no está en curso.')
      const result = await tx.agentOutbox.update({ where: { id: row.id }, data: { status: 'UNCERTAIN' } })
      await this.reviewTask(tx, row, 'NO_PROVIDER_ACKNOWLEDGEMENT')
      return result
    })
  }

  private reviewTask(tx: Prisma.TransactionClient, row: AgentOutbox, code: string) {
    return tx.task.upsert({ where: { tenantId_dedupeKey: { tenantId: this.tenantId, dedupeKey: `outbox-review:${row.id}` } },
      create: { tenantId: this.tenantId, conversationId: row.conversationId, type: 'CONTACT_CUSTOMER', title: 'Verificar envío sin confirmación antes de reenviar',
        dedupeKey: `outbox-review:${row.id}`, details: { outboxId: row.id, turnId: row.turnId, code } }, update: {} })
  }
}
