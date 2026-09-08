import { Module } from '@nestjs/common'
import { PricingModule } from '../pricing/pricing.module.js'
import { QuotePdfService } from './quote-pdf.service.js'
import { QuotesController } from './quotes.controller.js'
import { QuotesService } from './quotes.service.js'
import { QuoteAttachmentsService } from './quote-attachments.service.js'

@Module({
  imports: [PricingModule],
  controllers: [QuotesController],
  providers: [QuotesService, QuotePdfService, QuoteAttachmentsService],
  exports: [QuotesService, QuotePdfService],
})
export class QuotesModule {}
