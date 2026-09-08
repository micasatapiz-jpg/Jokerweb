import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import { WhatsAppDeliveryService } from './whatsapp-delivery.service.js'

// Only dispatches persisted outputs. It never processes inbound messages or calls AI.
@Injectable()
export class WhatsAppOutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppOutboxWorkerService.name)
  private readonly pollMs: number
  private timer?: NodeJS.Timeout
  private running = false

  constructor(config: ConfigService, private readonly db: PrismaService,
    private readonly tenant: LocalTenantService, private readonly delivery: WhatsAppDeliveryService) {
    const value = Number(config.get<string>('WHATSAPP_POLL_MS', '1500'))
    this.pollMs = Number.isFinite(value) ? Math.max(500, value) : 1500
  }

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.processPending().catch(() => this.logger.error('No se pudo consultar la cola WhatsApp.'))
    }, this.pollMs)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async processPending() {
    if (this.running) return { processed: 0 }
    this.running = true
    try {
      // Select only each chat's first unresolved output: a blocked chat must not
      // starve others or send later parts ahead of an uncertain earlier part.
      // Include HANDOFF/CLOSED so claimNext can allow an acknowledgement or
      // cancel obsolete outputs. Include expired SENDING to recover after restart.
      const rows = await this.db.$queryRaw<Array<{ conversationId: string }>>`
        SELECT head."conversationId" FROM (
          SELECT DISTINCT ON (o."conversationId") o."conversationId", o.status,
            o."leaseUntil", o."createdAt"
          FROM "AgentOutbox" o
          JOIN "Conversation" c ON c.id = o."conversationId" AND c."tenantId" = o."tenantId"
          WHERE o."tenantId" = ${this.tenant.tenantId}::uuid
            AND c.channel = 'WHATSAPP'
            AND o.status NOT IN ('SENT', 'CANCELLED')
          ORDER BY o."conversationId", o."createdAt", o.sequence, o.id
        ) head
        WHERE head.status = 'PENDING'
          OR (head.status = 'SENDING' AND (head."leaseUntil" IS NULL OR head."leaseUntil" <= NOW()))
        ORDER BY head."createdAt", head."conversationId" LIMIT 20
      `
      await Promise.all(rows.map(async ({ conversationId }) => {
        try {
          // claimNext supplies the cross-replica lock/lease; never send without it.
          await this.delivery.processAgentOutbox(conversationId)
        } catch {
          // Do not log tokens, customer payloads or provider error bodies.
          this.logger.error(`Salida WhatsApp pendiente de revisión: ${conversationId}`)
        }
      }))
      return { processed: rows.length }
    } finally {
      this.running = false
    }
  }
}
