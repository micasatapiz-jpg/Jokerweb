import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AIService } from '../ai/ai.service.js'
import type { QuoteRequirements } from '../ai/quote-requirements.schema.js'
import { CommunicationsService } from '../communications/communications.service.js'
import { Prisma } from '../generated/prisma/client.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import { WhatsAppGatewayService } from './whatsapp-gateway.service.js'

type ConversationContext = {
  requirements?: QuoteRequirements
  logoMediaId?: string
  spacePhotoMediaId?: string
  audioTranscripts?: string[]
  pendingJobs?: string[]
  pricingBlockedReason?: string
}

function isGreetingOnly(text: string) {
  return /^(hola|buenos dias|buenos días|buenas tardes|buenas noches|ola|hi)[.!\s]*$/i.test(text.trim())
}

function declinesSpacePhoto(text: string) {
  return /(no (puedo|tengo)|más tarde|mas tarde|por ahora no|sin foto|fondo neutro)/i.test(text)
}

function looksComplex(text: string, productType?: string | null) {
  return /(letrero|luminos|corp[oó]rea|fachada|caja de luz|proyecto)/i.test(`${productType ?? ''} ${text}`)
}

function applyExplicitDimensions(requirements: QuoteRequirements | undefined, text: string) {
  if (!requirements) return requirements
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:m|metros?)?\s*(?:x|por)\s*(\d+(?:[.,]\d+)?)\s*(?:m|metros?)?/i)
  if (!match) return requirements
  const widthM = Number(match[1].replace(',', '.'))
  const heightM = Number(match[2].replace(',', '.'))
  if (!Number.isFinite(widthM) || !Number.isFinite(heightM) || widthM <= 0 || heightM <= 0) return requirements
  return {
    ...requirements,
    widthM,
    heightM,
    quantity: requirements.quantity ?? 1,
    missingFields: requirements.missingFields.filter((field) => !/(medida|ancho|alto)/i.test(field)),
  }
}

function mergeRequirements(previous: QuoteRequirements | undefined, current: QuoteRequirements) {
  if (!previous) return current
  return {
    ...current,
    productType: current.productType ?? previous.productType,
    widthM: current.widthM ?? previous.widthM,
    heightM: current.heightM ?? previous.heightM,
    quantity: current.quantity ?? previous.quantity,
    material: current.material ?? previous.material,
    installationRequired: current.installationRequired ?? previous.installationRequired,
    location: current.location ?? previous.location,
    requestedDate: current.requestedDate ?? previous.requestedDate,
    notes: [...new Set([...previous.notes, ...current.notes])],
    confidence: Math.max(previous.confidence, current.confidence),
  }
}

@Injectable()
export class WhatsAppProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppProcessorService.name)
  private readonly debounceMs: number
  private readonly pollMs: number
  private timer?: NodeJS.Timeout
  private readonly processing = new Set<string>()

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
    private readonly ai: AIService,
    private readonly communications: CommunicationsService,
    private readonly gateway: WhatsAppGatewayService,
  ) {
    this.debounceMs = Math.max(1000, Number(config.get<string>('WHATSAPP_DEBOUNCE_MS', '10000')))
    this.pollMs = Math.max(500, Number(config.get<string>('WHATSAPP_POLL_MS', '1500')))
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.processPending().catch((error) => this.logger.error(error)), this.pollMs)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async processPending() {
    const cutoff = new Date(Date.now() - this.debounceMs)
    const conversations = await this.prisma.conversation.findMany({
      where: {
        tenantId: this.tenant.tenantId,
        channel: 'WHATSAPP',
        lastInboundAt: { lte: cutoff },
        messages: { some: { direction: 'INBOUND', status: 'BUFFERED' } },
      },
      orderBy: { lastInboundAt: 'asc' },
      take: 10,
    })
    await Promise.all(conversations.map((conversation) => this.processConversation(conversation.id)))
    return { processed: conversations.length }
  }

  async processConversation(conversationId: string) {
    if (this.processing.has(conversationId)) return
    this.processing.add(conversationId)
    try {
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: conversationId, tenantId: this.tenant.tenantId },
        include: {
          messages: {
            where: { direction: 'INBOUND', status: 'BUFFERED' },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
      if (!conversation || conversation.messages.length === 0) return

      const context = (conversation.context ?? {}) as ConversationContext
      const textParts: string[] = []
      const audioTranscripts = [...(context.audioTranscripts ?? [])]
      let logoMediaId = context.logoMediaId
      let spacePhotoMediaId = context.spacePhotoMediaId

      for (const message of conversation.messages) {
        if (message.text) textParts.push(message.text)
        if (message.type === 'IMAGE' && message.mediaId) {
          const caption = message.text ?? ''
          if (/espacio|lugar|local|fachada|pared/i.test(caption) || (logoMediaId && conversation.spacePhotoAskedAt)) {
            spacePhotoMediaId = message.mediaId
          } else if (!logoMediaId) {
            logoMediaId = message.mediaId
          }
        }
        if (message.type === 'AUDIO' && message.mediaId) {
          try {
            const media = await this.gateway.downloadMedia(message.mediaId)
            const transcript = await this.communications.transcribe({
              buffer: media.buffer,
              filename: message.fileName ?? `whatsapp-${message.id}.ogg`,
              mimeType: media.mimeType,
            })
            audioTranscripts.push(transcript.text)
            textParts.push(transcript.text)
          } catch (error) {
            this.logger.warn(`Audio pendiente ${message.id}: ${error instanceof Error ? error.message : 'error'}`)
          }
        }
      }

      const combinedText = textParts.join('\n').trim()
      const declined = declinesSpacePhoto(combinedText)
      let requirements = context.requirements
      if (combinedText.length >= 10 && !isGreetingOnly(combinedText)) {
        try {
          requirements = mergeRequirements(context.requirements, (await this.ai.analyze(combinedText)).requirements)
          requirements = applyExplicitDimensions(requirements, combinedText)
        } catch (error) {
          this.logger.warn(`La IA no pudo analizar ${conversationId}: ${error instanceof Error ? error.message : 'error'}`)
        }
      }

      const complex = looksComplex(combinedText, requirements?.productType)
      const needsAddress = complex && requirements?.installationRequired !== false && !requirements?.location
      const needsDimensions = complex && (!requirements?.widthM || !requirements?.heightM)
      const shouldAskSpacePhoto = complex && !spacePhotoMediaId && !declined && !conversation.spacePhotoAskedAt
      const pendingJobs = [
        'CALCULATE_DETERMINISTIC_QUOTE',
        'GENERATE_QUOTE_PDF',
        'GENERATE_CUSTOMER_AUDIO',
      ]
      if (logoMediaId) pendingJobs.splice(1, 0, spacePhotoMediaId ? 'GENERATE_CONTEXTUAL_VISUAL' : 'GENERATE_NEUTRAL_VISUAL')

      const nextContext: ConversationContext = {
        requirements,
        logoMediaId,
        spacePhotoMediaId,
        audioTranscripts,
        pendingJobs,
        pricingBlockedReason: 'Pendiente cargar las tarifas reales y reglas por producto.',
      }

      const paragraphs: string[] = []
      if (combinedText && !isGreetingOnly(combinedText)) {
        paragraphs.push('Gracias, ya reuní la información que enviaste para preparar tu propuesta.')
        const questions: string[] = []
        if (complex && !logoMediaId) questions.push('el archivo o foto de tu logo')
        if (needsDimensions) questions.push('el ancho y alto aproximados')
        if (needsAddress) questions.push('la dirección o al menos el distrito donde se instalará, para calcular movilidad y viáticos')
        if (questions.length) paragraphs.push(`Para completar el cálculo, envíame ${questions.join(', ')}.`)
        if (shouldAskSpacePhoto) {
          paragraphs.push('Opcionalmente, puedes enviar una foto del espacio donde irá el letrero para mostrarlo en el lugar real. Si no puedes ahora, continuaremos con una propuesta sobre fondo neutro.')
        }
        if (!questions.length) paragraphs.push('Registramos tu solicitud. El equipo revisará las tarifas para confirmar el presupuesto y enviarte la propuesta.')
      }

      if (paragraphs.length) {
        await this.gateway.sendText(conversation, paragraphs.join(' '))
      }

      const ready = Boolean(requirements?.productType) && (!complex || (!needsDimensions && !needsAddress))
      await this.prisma.$transaction([
        this.prisma.conversationMessage.updateMany({
          where: { id: { in: conversation.messages.map((message) => message.id) } },
          data: { status: 'PROCESSED', processedAt: new Date() },
        }),
        this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            status: ready ? 'READY_TO_QUOTE' : 'COLLECTING',
            lastProcessedAt: new Date(),
            spacePhotoAskedAt: shouldAskSpacePhoto ? new Date() : undefined,
            spacePhotoDeclinedAt: declined ? new Date() : undefined,
            context: nextContext as Prisma.InputJsonValue,
          },
        }),
      ])
    } catch (error) {
      this.logger.error(error)
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { status: 'ERROR' } }).catch(() => undefined)
    } finally {
      this.processing.delete(conversationId)
    }
  }
}
