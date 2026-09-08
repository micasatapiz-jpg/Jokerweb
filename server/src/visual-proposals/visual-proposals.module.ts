import { Module } from '@nestjs/common'
import { OpenAIVisualService } from './openai-visual.service.js'
import { VisualProposalsController } from './visual-proposals.controller.js'
import { VisualProposalsService } from './visual-proposals.service.js'
import { VisualStorageService } from './visual-storage.service.js'

@Module({
  controllers: [VisualProposalsController],
  providers: [VisualProposalsService, VisualStorageService, OpenAIVisualService],
  exports: [VisualProposalsService],
})
export class VisualProposalsModule {}
