import { Module } from '@nestjs/common'
import { AgentCoreModule } from './agent-core/agent-core.module.js'
import { ConfigModule } from '@nestjs/config'
import { AIModule } from './ai/ai.module.js'
import { CommonModule } from './common/common.module.js'
import { CommunicationsModule } from './communications/communications.module.js'
import { CustomersModule } from './customers/customers.module.js'
import { DatabaseModule } from './database/database.module.js'
import { HealthController } from './health.controller.js'
import { PricingModule } from './pricing/pricing.module.js'
import { ProductsModule } from './products/products.module.js'
import { QuotesModule } from './quotes/quotes.module.js'
import { VisualProposalsModule } from './visual-proposals/visual-proposals.module.js'
import { WhatsAppModule } from './whatsapp/whatsapp.module.js'

@Module({
  imports: [
    AgentCoreModule,
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    DatabaseModule,
    PricingModule,
    CommunicationsModule,
    AIModule,
    ProductsModule,
    CustomersModule,
    QuotesModule,
    VisualProposalsModule,
    WhatsAppModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
