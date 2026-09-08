import { Module } from '@nestjs/common'
import { CommercialService } from './commercial.service.js'
import { ContextBuilderService } from './context-builder.service.js'
import { ProductConfigurationService } from './product-configuration.service.js'
import { SalesAgentService } from './sales-agent.service.js'
import { QuoteWorkflowService } from './quote-workflow.service.js'
import { CustomerToolsService } from './customer-tools.service.js'
import { AgentTurnsService } from './agent-turns.service.js'
import { AgentOutboxService } from './agent-outbox.service.js'

@Module({ providers: [CommercialService, ContextBuilderService, ProductConfigurationService, SalesAgentService, QuoteWorkflowService, CustomerToolsService, AgentTurnsService, AgentOutboxService],
  exports: [CommercialService, ContextBuilderService, ProductConfigurationService, SalesAgentService, QuoteWorkflowService, CustomerToolsService, AgentTurnsService, AgentOutboxService] })
export class AgentCoreModule {}
