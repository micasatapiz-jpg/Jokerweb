import { Injectable } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'

export type IncomingMessage = {
  externalMessageId?: string
  from: string
  customerName?: string
  type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT'
  text?: string
  mediaId?: string
  mimeType?: string
  fileName?: string
  payload?: unknown
  source?: 'VERIFIED_WEBHOOK' | 'SIMULATION'
}

@Injectable()
export class WhatsAppConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
  ) {}

  async ingest(input: IncomingMessage) {
    return this.prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${this.tenant.tenantId+':chat:'+input.from},0))`
    const now = new Date()
    const conversation = await tx.conversation.upsert({
      where: {
        tenantId_channel_externalId: {
          tenantId: this.tenant.tenantId,
          channel: 'WHATSAPP',
          externalId: input.from,
        },
      },
      create: {
        tenantId: this.tenant.tenantId,
        channel: 'WHATSAPP',
        externalId: input.from,
        customerPhone: input.from,
        customerName: input.customerName,
        lastInboundAt: now,
      },
      update: {
        customerName: input.customerName || undefined,
        customerPhone: input.from,
        lastInboundAt: now,
      },
    })

    if (input.externalMessageId) {
      const duplicate = await tx.conversationMessage.findUnique({
        where: {
          conversationId_externalMessageId: {
            conversationId: conversation.id,
            externalMessageId: input.externalMessageId,
          },
        },
      })
      if (duplicate) return { conversation, duplicate: true, shouldGreet: false }
    }

    const actor = input.source === 'VERIFIED_WEBHOOK'
      ? await tx.actorIdentity.findFirst({ where:{ tenantId:this.tenant.tenantId,channel:'WHATSAPP',externalSubject:input.from,active:true } })
      : null
    const saved=await tx.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        externalMessageId: input.externalMessageId,
        direction: 'INBOUND',
        senderExternalId: input.from,
        authorType: actor?.type ?? 'CUSTOMER',
        authorId: actor?.id ?? null,
        source: input.source ?? 'UNVERIFIED',
        type: input.type,
        text: input.text,
        mediaId: input.mediaId,
        mimeType: input.mimeType,
        fileName: input.fileName,
        status: 'BUFFERED',
        payload: input.payload ? input.payload as Prisma.InputJsonValue : undefined,
      },
    })

    if(!actor)await emitStoredEvent(tx,this.tenant.tenantId,{conversationId:conversation.id,type:input.type==='TEXT'?'CUSTOMER_MESSAGE_RECEIVED':'CUSTOMER_FILE_RECEIVED',actorType:'CUSTOMER',sourceKey:`customer-received:${saved.id}`,payload:{sourceMessageId:saved.id,fileType:input.type,correlated:false}})
    const shouldGreet = !conversation.greetedAt
    // Acknowledgement is recorded by the worker only after the buffered greeting is sent.
    return { conversation, duplicate: false, shouldGreet }
    })
  }

  async recordOutbound(
    conversationId: string,
    text: string,
    externalMessageId?: string,
    failed = false,
    type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' = 'TEXT',
    payload?: unknown,
  ) {
    return this.prisma.conversationMessage.create({
      data: {
        conversationId,
        externalMessageId,
        direction: 'OUTBOUND',
        authorType: 'AI_AGENT',
        source: 'AGENT_OUTBOX',
        type,
        text,
        status: failed ? 'FAILED' : 'SENT',
        payload: payload ? payload as Prisma.InputJsonValue : undefined,
      },
    })
  }

  list(limit = 50) {
    return this.prisma.conversation.findMany({
      where: { tenantId: this.tenant.tenantId, channel: 'WHATSAPP' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })
  }
}
import { emitStoredEvent } from '../agent-core/agent-event-store.js'
