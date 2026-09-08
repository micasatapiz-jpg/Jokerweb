import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { MultipartFile, MultipartValue } from '@fastify/multipart'
import type { FastifyRequest } from 'fastify'
import { LocalTenantService } from '../common/local-tenant.service.js'
import { PrismaService } from '../database/prisma.service.js'
import { OpenAIVisualService } from './openai-visual.service.js'
import { allowedImageTypes, createProposalFieldsSchema, generateProposalFieldsSchema, type LogoAnalysis } from './visual-proposals.schemas.js'
import { VisualStorageService } from './visual-storage.service.js'

type UploadedImage = { buffer: Buffer; filename: string; mimetype: string }

@Injectable()
export class VisualProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: LocalTenantService,
    private readonly storage: VisualStorageService,
    private readonly openai: OpenAIVisualService,
  ) {}

  private async readMultipart(request: FastifyRequest) {
    const fields: Record<string, string> = {}
    const files: Record<string, UploadedImage> = {}

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const file = part as MultipartFile
        if (!allowedImageTypes.includes(file.mimetype as (typeof allowedImageTypes)[number])) {
          throw new BadRequestException('Solo se permiten imágenes PNG, JPG o WebP.')
        }
        files[file.fieldname] = { buffer: await file.toBuffer(), filename: file.filename, mimetype: file.mimetype }
      } else {
        const field = part as MultipartValue
        fields[field.fieldname] = String(field.value)
      }
    }
    return { fields, files }
  }

  async create(request: FastifyRequest) {
    const { fields, files } = await this.readMultipart(request)
    const parsed = createProposalFieldsSchema.safeParse(fields)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => issue.message))
    const logo = files.logo
    if (!logo) throw new BadRequestException('Adjunta el logo del cliente.')

    const analysis = await this.openai.analyzeLogo(logo.buffer, logo.mimetype, parsed.data.description)
    const logoStorageKey = await this.storage.save(logo.buffer, logo.mimetype)
    const proposal = await this.prisma.visualProposal.create({
      data: {
        tenantId: this.tenant.tenantId,
        description: parsed.data.description,
        logoOriginalName: logo.filename,
        logoMimeType: logo.mimetype,
        logoStorageKey,
        analysis,
      },
    })
    return { ...proposal, analysis }
  }

  async generate(id: string, request: FastifyRequest) {
    const proposal = await this.prisma.visualProposal.findFirst({ where: { id, tenantId: this.tenant.tenantId } })
    if (!proposal) throw new NotFoundException('No encontramos esta propuesta visual.')

    const { fields, files } = await this.readMultipart(request)
    const parsed = generateProposalFieldsSchema.safeParse(fields)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => issue.message))
    const { mode, notes } = parsed.data
    const spacePhoto = files.spacePhoto
    if (mode === 'CONTEXTUAL' && !spacePhoto) throw new BadRequestException('Adjunta la foto del espacio después de aceptar su uso.')
    if (mode === 'NEUTRAL' && spacePhoto) throw new BadRequestException('No envíes una foto del espacio cuando eliges fondo neutro.')

    const logo = await this.storage.read(proposal.logoStorageKey)
    const analysis = proposal.analysis as LogoAnalysis

    try {
      const output = await this.openai.generateProposal({
        logo,
        logoMimeType: proposal.logoMimeType,
        description: proposal.description,
        analysis,
        mode,
        spacePhoto: spacePhoto?.buffer,
        spaceMimeType: spacePhoto?.mimetype,
        notes,
      })
      const outputStorageKey = await this.storage.save(output, 'image/png')
      const spaceStorageKey = spacePhoto ? await this.storage.save(spacePhoto.buffer, spacePhoto.mimetype) : null
      const updated = await this.prisma.visualProposal.update({
        where: { id: proposal.id },
        data: {
          mode,
          spacePhotoConsent: mode === 'CONTEXTUAL',
          spaceMimeType: spacePhoto?.mimetype ?? null,
          spaceStorageKey,
          outputStorageKey,
          status: 'GENERATED',
          error: null,
        },
      })
      return { ...updated, analysis, imageUrl: `/api/visual-proposals/${id}/image` }
    } catch (error) {
      await this.prisma.visualProposal.update({
        where: { id: proposal.id },
        data: { status: 'ERROR', error: error instanceof Error ? error.message.slice(0, 1000) : 'Error desconocido' },
      })
      throw error
    }
  }

  async image(id: string) {
    const proposal = await this.prisma.visualProposal.findFirst({
      where: { id, tenantId: this.tenant.tenantId },
      select: { outputStorageKey: true },
    })
    if (!proposal?.outputStorageKey) throw new NotFoundException('La imagen aún no está disponible.')
    return this.storage.read(proposal.outputStorageKey)
  }
}
