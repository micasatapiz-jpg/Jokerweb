import { Module } from '@nestjs/common'
import { QuotesModule } from '../quotes/quotes.module.js'
import { CommunicationsController } from './communications.controller.js'
import { CommunicationsService } from './communications.service.js'
import { OpenAIAudioService } from './openai-audio.service.js'
import { QuoteMessageService } from './quote-message.service.js'

@Module({
  imports: [QuotesModule],
  controllers: [CommunicationsController],
  providers: [CommunicationsService, OpenAIAudioService, QuoteMessageService],
  exports: [CommunicationsService, QuoteMessageService],
})
export class CommunicationsModule {}
