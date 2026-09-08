import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WhatsAppConversationsService } from './whatsapp-conversations.service.js'

interface MetaSendResponse {
  messages?: Array<{ id?: string }>
  error?: { message?: string }
}

@Injectable()
export class WhatsAppGatewayService {
  readonly mode: 'simulate' | 'cloud'
  private readonly accessToken: string
  private readonly phoneNumberId: string
  private readonly graphVersion: string
  private readonly appSecret: string

  constructor(
    config: ConfigService,
    private readonly conversations: WhatsAppConversationsService,
  ) {
    this.mode =
      config.get<string>('WHATSAPP_MODE', 'simulate') === 'cloud'
        ? 'cloud'
        : 'simulate'

    this.accessToken = config
      .get<string>('WHATSAPP_ACCESS_TOKEN', '')
      .trim()

    this.phoneNumberId = config
      .get<string>('WHATSAPP_PHONE_NUMBER_ID', '')
      .trim()

    this.graphVersion = config
      .get<string>('WHATSAPP_GRAPH_VERSION', '')
      .trim()

    this.appSecret = config
      .get<string>('WHATSAPP_APP_SECRET', '')
      .trim()
  }

  verifySignature(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    if (this.mode === 'simulate') return true

    if (
      !this.appSecret ||
      !rawBody ||
      !signature?.startsWith('sha256=')
    ) {
      throw new UnauthorizedException(
        'No se pudo validar la firma del webhook de Meta.',
      )
    }

    const expected = Buffer.from(
      `sha256=${createHmac('sha256', this.appSecret)
        .update(rawBody)
        .digest('hex')}`,
    )

    const received = Buffer.from(signature)

    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException(
        'Firma del webhook de Meta inválida.',
      )
    }

    return true
  }

  /*
   * NUEVO TRANSPORTE RAW PARA AGENT OUTBOX
   *
   * Este método:
   * - envía el mensaje
   * - obtiene el ID del proveedor
   * - NO escribe ConversationMessage
   *
   * AgentOutboxService.acknowledge() será quien registre
   * el mensaje saliente de forma persistente.
   */
  async sendTextRaw(
    conversation: {
      id: string
      externalId: string
    },
    text: string,
  ) {
    if (this.mode === 'simulate') {
      return {
        simulated: true,
        externalMessageId: `sim-${randomUUID()}`,
      }
    }

    if (
      !this.accessToken ||
      !this.phoneNumberId ||
      !this.graphVersion
    ) {
      throw new ServiceUnavailableException(
        'Completa WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_GRAPH_VERSION.',
      )
    }

    const response = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: conversation.externalId,
          type: 'text',
          text: {
            preview_url: false,
            body: text,
          },
        }),
      },
    )

    const payload = (await response.json()) as MetaSendResponse

    if (!response.ok) {
      throw new ServiceUnavailableException(
        payload.error?.message ??
          `Meta respondió HTTP ${response.status}`,
      )
    }

    const externalMessageId = payload.messages?.[0]?.id

    if (!externalMessageId) {
      throw new ServiceUnavailableException(
        'Meta confirmó el envío pero no devolvió un identificador de mensaje.',
      )
    }

    return {
      simulated: false,
      externalMessageId,
    }
  }

  /*
   * FLUJO LEGACY
   *
   * Se mantiene temporalmente porque otras partes del sistema
   * todavía pueden usar sendText().
   *
   * Este método SÍ registra ConversationMessage.
   */
  async sendText(
    conversation: {
      id: string
      externalId: string
    },
    text: string,
  ) {
    if (this.mode === 'simulate') {
      await this.conversations.recordOutbound(
        conversation.id,
        text,
        `sim-${randomUUID()}`,
      )

      return {
        simulated: true,
      }
    }

    if (
      !this.accessToken ||
      !this.phoneNumberId ||
      !this.graphVersion
    ) {
      throw new ServiceUnavailableException(
        'Completa WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_GRAPH_VERSION.',
      )
    }

    const response = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: conversation.externalId,
          type: 'text',
          text: {
            preview_url: false,
            body: text,
          },
        }),
      },
    )

    const payload = (await response.json()) as MetaSendResponse

    if (!response.ok) {
      await this.conversations.recordOutbound(
        conversation.id,
        text,
        undefined,
        true,
      )

      throw new ServiceUnavailableException(
        payload.error?.message ??
          `Meta respondió HTTP ${response.status}`,
      )
    }

    await this.conversations.recordOutbound(
      conversation.id,
      text,
      payload.messages?.[0]?.id,
    )

    return payload
  }

  async downloadMedia(mediaId: string) {
    if (
      this.mode !== 'cloud' ||
      !this.accessToken ||
      !this.graphVersion
    ) {
      throw new ServiceUnavailableException(
        'La descarga de medios requiere WhatsApp Cloud API configurada.',
      )
    }

    const metadataResponse = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/${mediaId}`,
      {
        headers: {
          authorization: `Bearer ${this.accessToken}`,
        },
      },
    )

    const metadata =
      (await metadataResponse.json()) as {
        url?: string
        mime_type?: string
        error?: { message?: string }
      }

    if (
      !metadataResponse.ok ||
      !metadata.url
    ) {
      throw new ServiceUnavailableException(
        metadata.error?.message ??
          'Meta no devolvió la URL del archivo.',
      )
    }

    const mediaResponse = await fetch(
      metadata.url,
      {
        headers: {
          authorization: `Bearer ${this.accessToken}`,
        },
      },
    )

    if (!mediaResponse.ok) {
      throw new ServiceUnavailableException(
        `No se pudo descargar el archivo de WhatsApp (${mediaResponse.status}).`,
      )
    }

    return {
      buffer: Buffer.from(
        await mediaResponse.arrayBuffer(),
      ),
      mimeType:
        metadata.mime_type ??
        mediaResponse.headers.get('content-type') ??
        'application/octet-stream',
    }
  }

  async sendMedia(
    conversation: {
      id: string
      externalId: string
    },
    input: {
      type: 'image' | 'audio' | 'document'
      buffer: Buffer
      mimeType: string
      fileName: string
      caption?: string
    },
  ) {
    const storedType =
      input.type.toUpperCase() as
        | 'IMAGE'
        | 'AUDIO'
        | 'DOCUMENT'

    if (this.mode === 'simulate') {
      await this.conversations.recordOutbound(
        conversation.id,
        `[${storedType}] ${input.fileName}${
          input.caption
            ? ` — ${input.caption}`
            : ''
        }`,
        `sim-${randomUUID()}`,
        false,
        storedType,
        {
          simulated: true,
          mimeType: input.mimeType,
          sizeBytes: input.buffer.length,
        },
      )

      return {
        simulated: true,
      }
    }

    if (
      !this.accessToken ||
      !this.phoneNumberId ||
      !this.graphVersion
    ) {
      throw new ServiceUnavailableException(
        'WhatsApp Cloud API aún no está configurada.',
      )
    }

    const form = new FormData()

    form.append(
      'messaging_product',
      'whatsapp',
    )

    form.append(
      'type',
      input.mimeType,
    )

    form.append(
      'file',
      new Blob(
        [new Uint8Array(input.buffer)],
        {
          type: input.mimeType,
        },
      ),
      input.fileName,
    )

    const uploadResponse = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/media`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.accessToken}`,
        },
        body: form,
      },
    )

    const upload =
      (await uploadResponse.json()) as {
        id?: string
        error?: { message?: string }
      }

    if (
      !uploadResponse.ok ||
      !upload.id
    ) {
      throw new ServiceUnavailableException(
        upload.error?.message ??
          'No se pudo subir el archivo a Meta.',
      )
    }

    const mediaObject =
      input.type === 'audio'
        ? {
            id: upload.id,
          }
        : input.type === 'document'
          ? {
              id: upload.id,
              filename: input.fileName,
              caption: input.caption,
            }
          : {
              id: upload.id,
              caption: input.caption,
            }

    const sendResponse = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: conversation.externalId,
          type: input.type,
          [input.type]: mediaObject,
        }),
      },
    )

    const sent =
      (await sendResponse.json()) as MetaSendResponse

    if (!sendResponse.ok) {
      throw new ServiceUnavailableException(
        sent.error?.message ??
          'Meta no pudo enviar el archivo.',
      )
    }

    await this.conversations.recordOutbound(
      conversation.id,
      `[${storedType}] ${input.fileName}`,
      sent.messages?.[0]?.id,
      false,
      storedType,
      {
        mediaId: upload.id,
        mimeType: input.mimeType,
      },
    )

    return sent
  }
}
