import { Body, Controller, Post } from '@nestjs/common'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { calculateQuoteSchema, type CalculateQuoteInput } from './pricing.schemas.js'
import { PricingService } from './pricing.service.js'

@Controller('quotes')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Post('calculate')
  calculate(
    @Body(new ZodValidationPipe(calculateQuoteSchema)) input: CalculateQuoteInput,
  ) {
    return this.pricing.calculate(input)
  }
}

