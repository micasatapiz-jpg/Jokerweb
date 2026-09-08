import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { MultipartFile, MultipartValue } from '@fastify/multipart'
import type { FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import { allowedQuoteImageTypes, quoteAttachmentFieldsSchema } from './quote-attachments.schemas.js'

const extensionByMime: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}

@Injectable()
export class QuoteAttachmentsService {
  private readonly root: string

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
  ) {
    this.root = resolve(config.get<string>('QUOTE_ATTACHMENTS_DIR') ?? 'uploads/quote-attachments')
  }

  async create(quoteId: string, request: FastifyRequest) {
    const quote = await this.prisma.quote.findFirst({ where: { id: quoteId, tenantId: this.tenant.tenantId } })
    if (!quote) throw new NotFoundException('No encontramos la cotización para adjuntar la imagen.')

    const fields: Record<string, string> = {}
    let uploaded: { buffer: Buffer; filename: string; mimetype: string } | undefined
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const file = part as MultipartFile
        if (uploaded) throw new BadRequestException('Sube una imagen por solicitud.')
        if (!allowedQuoteImageTypes.includes(file.mimetype as (typeof allowedQuoteImageTypes)[number])) {
          throw new BadRequestException('Solo se permiten imágenes PNG, JPG o WebP.')
        }
        uploaded = { buffer: await file.toBuffer(), filename: file.filename, mimetype: file.mimetype }
      } else {
        const field = part as MultipartValue
        fields[field.fieldname] = String(field.value)
      }
    }

    const parsed = quoteAttachmentFieldsSchema.safeParse(fields)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => issue.message))
    if (!uploaded || uploaded.buffer.length === 0) throw new BadRequestException('Selecciona una imagen.')

    await mkdir(this.root, { recursive: true })
    const storageKey = `${randomUUID()}${extensionByMime[uploaded.mimetype]}`
    await writeFile(resolve(this.root, storageKey), uploaded.buffer)
    return this.prisma.attachment.create({
      data: {
        tenantId: this.tenant.tenantId,
        quoteId,
        originalName: uploaded.filename,
        mimeType: uploaded.mimetype,
        sizeBytes: uploaded.buffer.length,
        storageKey,
        kind: parsed.data.kind,
        description: parsed.data.description,
        aiConsent: true,
      },
    })
  }

  async read(quoteId: string, attachmentId: string) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, quoteId, tenantId: this.tenant.tenantId },
    })
    if (!attachment) throw new NotFoundException('No encontramos la imagen solicitada.')
    if (!/^[a-f0-9-]+\.(png|jpg|webp)$/i.test(attachment.storageKey)) throw new BadRequestException('Ruta de imagen inválida.')
    return { attachment, buffer: await readFile(resolve(this.root, attachment.storageKey)) }
  }
}
