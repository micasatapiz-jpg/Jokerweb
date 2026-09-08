import { ConfigService } from '@nestjs/config'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentInterpreterService } from './agent-interpreter.service.js'
import { OpenAIInterpreterTransport } from './openai-interpreter.transport.js'
import { interpretationSchema } from './agent-decision.js'

const { parse, construct } = vi.hoisted(() => ({ parse: vi.fn(), construct: vi.fn() }))
vi.mock('openai', () => ({ default: class { responses = { parse }; constructor(options: unknown) { construct(options) } } }))
afterEach(() => vi.clearAllMocks())

describe('Intérprete OpenAI preparado, red completamente simulada', () => {
  it('heuristic es el default y no crea cliente ni necesita API key', async () => {
    expect((await new AgentInterpreterService(new ConfigService()).interpret({ text: 'hola' })).intent).toBe('VENTA_NUEVA')
    expect(construct).not.toHaveBeenCalled()
  })
  it('configuración incompleta deriva sin llamada', async () => {
    const config = new ConfigService({ AGENT_INTERPRETER: 'openai', OPENAI_API_KEY: '', AGENT_OPENAI_MODEL: '' })
    const service = new AgentInterpreterService(config, new OpenAIInterpreterTransport(config))
    expect((await service.interpret({ text: 'hola' })).intent).toBe('SOLICITA_HUMANO')
    expect(construct).not.toHaveBeenCalled()
  })
  it('valida salida estructurada y construye la petición sin tools ni almacenamiento', async () => {
    parse.mockResolvedValueOnce({ status: 'completed', output_parsed: { intent: 'VENTA_NUEVA', productQuery: 'Producto ficticio', newJobExplicit: false,
      selectedJobId: null, requirements: [{ key: 'quantity', value: 3 }], ambiguousMeasurement: false, filePurpose: 'UNKNOWN' } })
    const config = new ConfigService({ AGENT_INTERPRETER: 'openai', OPENAI_API_KEY: 'test-not-a-real-key', AGENT_OPENAI_MODEL: 'fixture-model' })
    const service = new AgentInterpreterService(config, new OpenAIInterpreterTransport(config))
    expect(await service.interpret({ text: '3 unidades' })).toMatchObject({ requirements: { quantity: 3 } })
    expect(parse.mock.calls[0][0]).toMatchObject({ store: false, model: 'fixture-model', text: { format: { type: 'json_schema', strict: true } } })
    expect(parse.mock.calls[0][0]).not.toHaveProperty('tools')
    expect(construct.mock.calls[0][0]).toMatchObject({ timeout: 30000, maxRetries: 0 })
  })
  it.each([
    { intent: 'OWNER' }, { intent: 'VENTA_NUEVA', requirements: { total: 12 } },
    { intent: 'VENTA_NUEVA', requirements: { paymentConfirmed: true } },
    { intent: 'VENTA_NUEVA', role: 'OWNER' },
    { intent: 'VENTA_NUEVA', selectedJobId: '11111111-1111-4111-8111-111111111111' },
  ])('salida inválida no produce efectos: %j', async output => {
    const transport = { interpret: vi.fn().mockResolvedValue(output) }
    expect(await new AgentInterpreterService(new ConfigService({ AGENT_INTERPRETER: 'openai' }), transport as any).interpret({ text: 'fixture' }))
      .toEqual(interpretationSchema.parse({ intent: 'SOLICITA_HUMANO' }))
  })
  it.each([null, { intent: 'VENTA_NUEVA', requirements: [] }])('rechazo/incompleto pasa a fallback seguro', async output => {
    parse.mockResolvedValueOnce({ status: 'completed', output_parsed: output })
    const config = new ConfigService({ AGENT_INTERPRETER: 'openai', OPENAI_API_KEY: 'test-not-a-real-key', AGENT_OPENAI_MODEL: 'fixture-model' })
    expect((await new AgentInterpreterService(config, new OpenAIInterpreterTransport(config)).interpret({ text: 'fixture' })).intent).toBe('SOLICITA_HUMANO')
  })
})
