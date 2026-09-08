import { describe, expect, it, vi } from 'vitest'
import { executeDurableSalesPlan } from './durable-sales-plan.js'

describe('Ejecución del plan durable', () => {
  it('resuelve las referencias con recibos, callIds estables y respuesta derivada del resultado', async () => {
    const jobId = '11111111-1111-4111-8111-111111111111', productId = '22222222-2222-4222-8222-222222222222'
    const plan = { status: 'HUMAN_REVIEW', reply: 'Pendiente', tools: [
      { callId: 'create', name: 'createJob', args: { title: 'Fixture' } },
      { callId: 'save', name: 'saveRequirements', args: { jobId: '$jobId', productId, expectedRevision: '$revision', values: { quantity: 2 } } },
      { callId: 'quote', name: 'calculateQuote', args: { jobId: '$jobId', expectedRevision: '$revision' } },
    ] }
    const execute = vi.fn().mockResolvedValueOnce({ jobId, requirementsRevision: 0 }).mockResolvedValueOnce({ jobId, requirementsRevision: 1 }).mockResolvedValueOnce({ status: 'PENDING_APPROVAL' })
    expect(await executeDurableSalesPlan(plan, execute)).toContain('pendiente de revisión')
    expect(execute.mock.calls[2]).toEqual(['quote', { name: 'calculateQuote', args: { jobId, expectedRevision: 1 } }])
  })
  it.each(['confirmPayment', 'approveQuote', 'startProduction', 'setDeliveryDate', 'discount'])('rechaza herramienta privilegiada %s', async name => {
    const execute = vi.fn()
    await expect(executeDurableSalesPlan({ status: 'NO', reply: 'No', tools: [{ callId: 'x', name, args: {} }] }, execute)).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()
  })
  it('no confirma éxito si la herramienta falla', async () => {
    await expect(executeDurableSalesPlan({ status: 'NO', reply: 'No', tools: [{ callId: 'x', name: 'findJobs', args: {} }] }, vi.fn().mockRejectedValue(new Error('crash')))).rejects.toThrow('crash')
  })
})
