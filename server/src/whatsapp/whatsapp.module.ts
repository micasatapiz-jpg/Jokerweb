import { Module } from '@nestjs/common'
import { AIModule } from '../ai/ai.module.js'
import { CommunicationsModule } from '../communications/communications.module.js'
import { QuotesModule } from '../quotes/quotes.module.js'
import { VisualProposalsModule } from '../visual-proposals/visual-proposals.module.js'
import { AgentCoreModule } from '../agent-core/agent-core.module.js'
import { WhatsAppController } from './whatsapp.controller.js'
import { WhatsAppConversationsService } from './whatsapp-conversations.service.js'
import { WhatsAppGatewayService } from './whatsapp-gateway.service.js'
import { WhatsAppProcessorService } from './whatsapp-processor.service.js'
import { WhatsAppDeliveryService } from './whatsapp-delivery.service.js'
import { WhatsAppOutboxWorkerService } from './whatsapp-outbox-worker.service.js'

@Module({
  imports: [
    AgentCoreModule,
    AIModule,
    CommunicationsModule,
    QuotesModule,
    VisualProposalsModule,
  ],
  controllers: [
    WhatsAppController,
  ],
  providers: [
    WhatsAppConversationsService,
    WhatsAppGatewayService,
    WhatsAppProcessorService,
    WhatsAppDeliveryService,
    WhatsAppOutboxWorkerService,
  ],
})
export class WhatsAppModule {}
