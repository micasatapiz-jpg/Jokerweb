import type { QuoteRequirements } from './quote-requirements.schema.js'

export interface AIProvider {
  readonly name: 'OLLAMA' | 'OPENAI'
  readonly model: string
  extractQuoteRequirements(message: string, productNames: string[]): Promise<QuoteRequirements>
}

