import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common'
import { OperatorApiGuard, OperatorPermission } from '../common/operator-api.guard.js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { QuotePdfService } from './quote-pdf.service.js'
import { createQuoteSchema, type CreateQuoteInput } from './quotes.schemas.js'
import { QuotesService } from './quotes.service.js'
import { QuoteAttachmentsService } from './quote-attachments.service.js'

@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly pdf: QuotePdfService,
    private readonly attachments: QuoteAttachmentsService,
  ) {}

  @Get()
  list() {
    return this.quotes.list()
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(id)
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id', ParseUUIDPipe) id: string, @Res() reply: FastifyReply) {
    const quote = await this.quotes.get(id)
    const buffer = await this.pdf.render(quote)
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${quote.number}.pdf"`)
      .send(buffer)
  }

  @Post()
  create(@Body(new ZodValidationPipe(createQuoteSchema)) input: CreateQuoteInput) {
    return this.quotes.create(input)
  }

  @Post(':id/attachments')
  uploadAttachment(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    return this.attachments.create(id, request)
  }

  @Get(':quoteId/attachments/:attachmentId')
  async attachment(
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res() reply: FastifyReply,
  ) {
    const result = await this.attachments.read(quoteId, attachmentId)
    return reply.header('Content-Type', result.attachment.mimeType).header('Content-Disposition', 'inline').send(result.buffer)
  }

  @Post(':id/approve')
  @UseGuards(OperatorApiGuard)
  @OperatorPermission('APPROVE_QUOTE')
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.approve(id)
  }
}
