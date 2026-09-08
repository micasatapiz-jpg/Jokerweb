import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { RawBodyRequest } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { WhatsAppConversationsService, type IncomingMessage } from './whatsapp-conversations.service.js'
import { WhatsAppGatewayService } from './whatsapp-gateway.service.js'
import { WhatsAppProcessorService } from './whatsapp-processor.service.js'
import { WhatsAppDeliveryService } from './whatsapp-delivery.service.js'
import { simulateWhatsAppSchema, type MetaWebhookPayload, type SimulateWhatsAppInput } from './whatsapp.schemas.js'

@Controller('channels/whatsapp')
export class WhatsAppController {
  private readonly verifyToken: string

  constructor(
    config: ConfigService,
    private readonly conversations: WhatsAppConversationsService,
    private readonly gateway: WhatsAppGatewayService,
    private readonly processor: WhatsAppProcessorService,
    private readonly delivery: WhatsAppDeliveryService,
  ) {
    this.verifyToken = config.get<string>('WHATSAPP_VERIFY_TOKEN', '').trim()
  }

  @Get('status')
  status() {
    return { mode: this.gateway.mode, webhookPath: '/api/channels/whatsapp/webhook' }
  }

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() reply: FastifyReply,
  ) {
    if (mode === 'subscribe' && this.verifyToken && token === this.verifyToken) return reply.code(200).send(challenge)
    return reply.code(403).send('Verification failed')
  }

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: MetaWebhookPayload,
  ) {
    this.gateway.verifySignature(request.rawBody, signature)
    let accepted = 0
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const name = change.value?.contacts?.[0]?.profile?.name
        for (const message of change.value?.messages ?? []) {
          const media = message.image ?? message.audio ?? message.document
          const input: IncomingMessage = {
            externalMessageId: message.id,
            from: message.from,
            customerName: name,
            type: message.type === 'image' ? 'IMAGE' : message.type === 'audio' ? 'AUDIO' : message.type === 'document' ? 'DOCUMENT' : 'TEXT',
            text: message.text?.body ?? message.image?.caption ?? message.document?.caption,
            mediaId: media?.id,
            mimeType: media?.mime_type,
            fileName: message.document?.filename,
            payload: message,
          }
          const result = await this.conversations.ingest(input)
          if (!result.duplicate) accepted += 1
        }
      }
    }
    return { received: true, accepted }
  }

  @Post('simulate')
  async simulate(@Body(new ZodValidationPipe(simulateWhatsAppSchema)) input: SimulateWhatsAppInput) {
    let conversationId = ''
    for (const [index, message] of input.messages.entries()) {
      const result = await this.conversations.ingest({
        externalMessageId: `local-${Date.now()}-${index}`,
        from: input.from,
        customerName: input.name,
        type: message.type.toUpperCase() as IncomingMessage['type'],
        text: message.text,
        mediaId: message.mediaId,
        mimeType: message.mimeType,
        fileName: message.fileName,
        payload: { simulated: true },
      })
      conversationId = result.conversation.id
    }
    return { conversationId, buffered: input.messages.length, debounceMs: 'configurado en WHATSAPP_DEBOUNCE_MS' }
  }

  @Post('process-pending')
  processPending() {
    return this.processor.processPending()
  }

  @Get('conversations')
  conversationsList() {
    return this.conversations.list()
  }

  @Post('conversations/:conversationId/deliver-quote/:quoteId')
  deliverQuote(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ) {
    return this.delivery.deliver(conversationId, quoteId)
  }

}
