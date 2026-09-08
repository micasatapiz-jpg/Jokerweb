import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { VisualProposalsService } from './visual-proposals.service.js'

@Controller('visual-proposals')
export class VisualProposalsController {
  constructor(private readonly proposals: VisualProposalsService) {}

  @Post()
  create(@Req() request: FastifyRequest) {
    return this.proposals.create(request)
  }

  @Post(':id/generate')
  generate(@Param('id') id: string, @Req() request: FastifyRequest) {
    return this.proposals.generate(id, request)
  }

  @Get(':id/image')
  async image(@Param('id') id: string, @Res() reply: FastifyReply) {
    const image = await this.proposals.image(id)
    return reply.type('image/png').header('Cache-Control', 'private, max-age=3600').send(image)
  }
}
