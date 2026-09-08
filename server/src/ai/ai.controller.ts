import { Body, Controller, Post } from '@nestjs/common'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { AIService } from './ai.service.js'
import { analyzeRequestSchema, type AnalyzeRequest } from './quote-requirements.schema.js'

@Controller('quote-drafts')
export class AIController {
  constructor(private readonly ai: AIService) {}

  @Post('analyze')
  analyze(@Body(new ZodValidationPipe(analyzeRequestSchema)) input: AnalyzeRequest) {
    return this.ai.analyze(input.message)
  }
}

