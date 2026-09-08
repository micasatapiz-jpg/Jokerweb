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
}

@Injectable()
export class WhatsAppConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
  ) {}

  async ingest(input: IncomingMessage) {
    const now = new Date()
    const conversation = await this.prisma.conversation.upsert({
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
      const duplicate = await this.prisma.conversationMessage.findUnique({
        where: {
          conversationId_externalMessageId: {
            conversationId: conversation.id,
            externalMessageId: input.externalMessageId,
          },
        },
      })
      if (duplicate) return { conversation, duplicate: true, shouldGreet: false }
    }

    await this.prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        externalMessageId: input.externalMessageId,
        direction: 'INBOUND',
        type: input.type,
        text: input.text,
        mediaId: input.mediaId,
        mimeType: input.mimeType,
        fileName: input.fileName,
        status: 'BUFFERED',
        payload: input.payload ? input.payload as Prisma.InputJsonValue : undefined,
      },
    })

    const shouldGreet = !conversation.greetedAt
    // Acknowledgement is recorded by the worker only after the buffered greeting is sent.
    return { conversation, duplicate: false, shouldGreet }
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
