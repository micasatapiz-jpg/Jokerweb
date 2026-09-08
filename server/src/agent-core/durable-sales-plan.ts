import { z } from 'zod'
import { customerToolSchema } from './customer-tools.service.js'

// Only the deterministic planner emits this structure; interpreters cannot emit tools.
export const durableSalesPlanSchema = z.object({
  status: z.string().min(1), reply: z.string().trim().min(1).max(4000),
  task: z.string().optional(),
  tools: z.array(z.object({ callId: z.string().min(1).max(100), name: z.string(),
    args: z.record(z.string(), z.json()) }).strict()).max(12).default([]),
}).passthrough()
export type DurableSalesPlan = z.infer<typeof durableSalesPlanSchema>

export async function executeDurableSalesPlan(raw: unknown, execute: (callId: string, tool: unknown) => Promise<unknown>) {
  const plan = durableSalesPlanSchema.parse(raw)
  if (new Set(plan.tools.map(t => t.callId)).size !== plan.tools.length) throw new Error('CallId duplicado en el plan.')
  const refs: Record<string, unknown> = {}
  let reply = plan.reply
  for (const step of plan.tools) {
    const args = Object.fromEntries(Object.entries(step.args).map(([key, value]) => [key,
      value === '$jobId' || value === '$revision' ? refs[value] : value]))
    const tool = customerToolSchema.parse({ name: step.name, args })
    const result = await execute(step.callId, tool) as Record<string, unknown> | null
    if (result?.jobId) refs.$jobId = result.jobId
    if (typeof result?.requirementsRevision === 'number') refs.$revision = result.requirementsRevision
    if (tool.name === 'calculateQuote') {
      const status = result?.status
      if (status === 'PENDING_APPROVAL') reply = 'Preparé tu presupuesto y quedó pendiente de revisión del encargado. El importe todavía no está confirmado.'
      else if (status === 'CUSTOMER_DETAILS_REQUIRED') reply = '¿A qué nombre preparo la cotización?'
      else if (status === 'MISSING_DATA') reply = 'Todavía faltan datos válidos para calcular. Revisaremos los requisitos pendientes.'
      else if (status === 'RULE_NOT_CONFIGURED') reply = 'Este producto necesita una regla de precio aprobada. Dejé una tarea para que el encargado la revise.'
      else throw new Error('Resultado de cotización desconocido; no confirmar importes.')
    }
    if (tool.name === 'findQuote') {
      reply = result?.customerVisible === true && typeof result.total === 'string'
        ? `La cotización aprobada ${result.number} es de ${result.currency} ${result.total}.`
        : 'No hay un importe aprobado y vigente disponible para ese trabajo.'
    }
    if (tool.name === 'updateJobStatus' && tool.args.event === 'PAYMENT_REPORTED') reply = 'Registré tu aviso de pago. Está por confirmar; el encargado debe verificarlo.'
  }
  return reply
}
