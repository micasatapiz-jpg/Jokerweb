import { Module } from '@nestjs/common'
import { AIController } from './ai.controller.js'
import { AIService } from './ai.service.js'
import { OllamaProvider } from './ollama.provider.js'
import { OpenAIProvider } from './openai.provider.js'
import { ConfigService } from '@nestjs/config'

@Module({
  controllers: [AIController],
  providers: [AIService, OllamaProvider, OpenAIProvider, {
    provide: 'AI_PROVIDER',
    inject: [ConfigService, OllamaProvider, OpenAIProvider],
    useFactory: (config: ConfigService, ollama: OllamaProvider, openai: OpenAIProvider) => {
      const name = config.get<string>('AI_PROVIDER', 'ollama').toLowerCase()
      if (!['ollama', 'openai'].includes(name)) throw new Error('AI_PROVIDER debe ser ollama u openai.')
      return name === 'openai' ? openai : ollama
    },
  }],
  exports: [AIService],
})
export class AIModule {}
