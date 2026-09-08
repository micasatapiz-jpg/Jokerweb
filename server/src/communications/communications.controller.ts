import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common'
import type { MultipartFile } from '@fastify/multipart'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { CommunicationsService } from './communications.service.js'

@Controller()
export class CommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get('communications/status')
  status() {
    return this.communications.status()
  }

  @Post('communications/transcriptions')
  async transcribe(@Req() request: FastifyRequest) {
    let uploaded: { buffer: Buffer; filename: string; mimeType: string } | null = null

    for await (const part of request.parts()) {
      if (part.type !== 'file') continue
      const file = part as MultipartFile
      if (file.fieldname !== 'audio') {
        await file.toBuffer()
        continue
      }
      uploaded = {
        buffer: await file.toBuffer(),
        filename: file.filename || 'audio.webm',
        mimeType: file.mimetype,
      }
    }

    if (!uploaded) throw new BadRequestException('Adjunta un archivo en el campo audio.')
    return this.communications.transcribe(uploaded)
  }

  @Get('quotes/:id/customer-message')
  message(@Param('id', ParseUUIDPipe) id: string) {
    return this.communications.message(id)
  }

  @Post('quotes/:id/customer-message/audio')
  async speech(@Param('id', ParseUUIDPipe) id: string, @Res() reply: FastifyReply) {
    const result = await this.communications.speech(id)
    return reply
      .type('audio/mpeg')
      .header('Content-Disposition', `inline; filename="${result.message.quoteNumber}-resumen.mp3"`)
      .header('Cache-Control', 'no-store')
      .header('X-AI-Generated-Voice', 'true')
      .send(result.audio)
  }
}
