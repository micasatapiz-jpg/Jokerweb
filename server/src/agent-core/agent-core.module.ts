import { Module } from '@nestjs/common'
import { CommercialService } from './commercial.service.js'
import { ContextBuilderService } from './context-builder.service.js'
import { ProductConfigurationService } from './product-configuration.service.js'
import { SalesAgentService } from './sales-agent.service.js'
import { QuoteWorkflowService } from './quote-workflow.service.js'
import { CustomerToolsService } from './customer-tools.service.js'
import { AgentTurnsService } from './agent-turns.service.js'
import { AgentOutboxService } from './agent-outbox.service.js'
import { AgentInterpreterService } from './agent-interpreter.service.js'
import { OpenAIInterpreterTransport } from './openai-interpreter.transport.js'
import { OperatorControlsService } from './operator-controls.service.js'
import { CommercialKnowledgeService } from './commercial-knowledge.service.js'
import { AgentOrchestratorService } from './agent-orchestrator.service.js'
import { AgentEventWorkerService } from './agent-event-worker.service.js'
import { WorkflowOperationsService } from './workflow-operations.service.js'
import { WorkflowStepRunnerService } from './workflow-step-runner.service.js'

@Module({
  providers: [
    WorkflowStepRunnerService,
    WorkflowOperationsService,
    AgentOrchestratorService,
    AgentEventWorkerService,
    CommercialKnowledgeService,
    OperatorControlsService,
    CommercialService,
    ContextBuilderService,
    ProductConfigurationService,
    SalesAgentService,
    QuoteWorkflowService,
    CustomerToolsService,
    AgentTurnsService,
    AgentOutboxService,
    AgentInterpreterService,
    OpenAIInterpreterTransport,
  ],

  exports: [
    WorkflowStepRunnerService,
    WorkflowOperationsService,
    AgentOrchestratorService,
    AgentEventWorkerService,
    CommercialKnowledgeService,
    OperatorControlsService,
    CommercialService,
    ContextBuilderService,
    ProductConfigurationService,
    SalesAgentService,
    QuoteWorkflowService,
    CustomerToolsService,
    AgentTurnsService,
    AgentOutboxService,
    AgentInterpreterService,
  ],
})
export class AgentCoreModule {}
