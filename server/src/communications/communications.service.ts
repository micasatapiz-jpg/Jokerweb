import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import { OpenAIAudioService } from './openai-audio.service.js'
import { QuoteMessageService } from './quote-message.service.js'

export const allowedAudioTypes = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/opus',
  'video/mp4',
] as const

@Injectable()
export class CommunicationsService {
  constructor(
    private readonly audio: OpenAIAudioService,
    private readonly messages: QuoteMessageService,
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
  ) {}

  status() {
    return {
      openaiEnabled: this.audio.enabled,
      transcriptionModel: this.audio.transcriptionModel,
      speechModel: this.audio.speechModel,
      speechVoice: this.audio.voice,
      voiceDisclosure: 'La voz que escucha el cliente es generada por inteligencia artificial.',
    }
  }

  async transcribe(input: { buffer: Buffer; filename: string; mimeType: string }) {
    if (!allowedAudioTypes.includes(input.mimeType as (typeof allowedAudioTypes)[number])) {
      throw new BadRequestException('Formato no permitido. Usa MP3, M4A, WAV, WebM, OGG, Opus o MP4.')
    }
    if (input.buffer.length === 0) throw new BadRequestException('El archivo de audio está vacío.')

    const startedAt = Date.now()
    try {
      const text = await this.audio.transcribe(input)
      await this.prisma.aIInteraction.create({
        data: {
          tenantId: this.tenant.tenantId,
          provider: 'OPENAI',
          model: this.audio.transcriptionModel,
          status: 'SUCCESS',
          inputText: `[AUDIO] ${input.filename}`,
          outputJson: { transcript: text, mimeType: input.mimeType } as Prisma.InputJsonValue,
          durationMs: Date.now() - startedAt,
        },
      })
      return { text, provider: 'OPENAI', model: this.audio.transcriptionModel }
    } catch (error) {
      await this.prisma.aIInteraction.create({
        data: {
          tenantId: this.tenant.tenantId,
          provider: 'OPENAI',
          model: this.audio.transcriptionModel,
          status: 'ERROR',
          inputText: `[AUDIO] ${input.filename}`,
          error: (error instanceof Error ? error.message : 'Error desconocido').slice(0, 1000),
          durationMs: Date.now() - startedAt,
        },
      }).catch(() => undefined)
      throw error
    }
  }

  message(quoteId: string) {
    return this.messages.build(quoteId)
  }

  async speech(quoteId: string) {
    const message = await this.messages.build(quoteId)
    const audio = await this.audio.synthesize(message.text)
    return { audio, message }
  }
}
