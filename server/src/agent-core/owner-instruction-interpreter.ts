export type OwnerInstruction =
  | { action: 'MODE'; mode: 'AUTO' | 'ASSIST' | 'HUMAN_TAKEOVER' | 'PAUSED'; target: string }
  | { action: 'PURPOSE'; purpose: string; target: string; role?: string }
  | { action: 'TAG'; tag: string; remove: boolean; target: string }
  | { action: 'PERMISSION'; permission: 'CREATE_JOB'; granted: boolean; target: string }
  | { action: 'MANUAL_JOB'; contactName: string; title: string; requirements: Record<string, string | number | null> }
  | { action: 'VIEW_JOBS' }
  | { action: 'LIST_REVIEWS' }
  | { action: 'REVIEW'; reviewId:string; decision:'APPROVE_EMPLOYEE' | 'REJECT_EMPLOYEE' | 'BLOCK' | 'IGNORE' | 'KEEP_ACTIVE' | 'MARK_VALID' }
  | { action: 'UNKNOWN' }
  | { action: 'SENSITIVE_REQUEST'; permission:'CONFIRM_PAYMENT' | 'APPROVE_SPECIAL_PRICE' }

// Pure parser. Its result has no authority until OperatorService checks the source.
export function interpretOwnerInstruction(text: string): OwnerInstruction {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/^joker[, :]*/, '')
  const target = (pattern: RegExp) => pattern.exec(t)?.[1]?.trim().replace(/[.!]$/, '') || 'este chat'
  if (/^(ver|lista|muestra)( las)? revisiones( pendientes)?[.!]?$/.test(t)) return { action:'LIST_REVIEWS' }
  const review = /^(aprueba empleado|rechaza empleado|bloquea|ignora|mantener activo|marca valido) revision ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(t)
  if (review) return { action:'REVIEW',reviewId:review[2]!,decision:({ 'aprueba empleado':'APPROVE_EMPLOYEE','rechaza empleado':'REJECT_EMPLOYEE',bloquea:'BLOCK',ignora:'IGNORE','mantener activo':'KEEP_ACTIVE','marca valido':'MARK_VALID' } as const)[review[1]! as 'aprueba empleado'] }
  if (/confirma.*pago/.test(t)) return { action:'SENSITIVE_REQUEST',permission:'CONFIRM_PAYMENT' }
  if (/cambia.*precio/.test(t)) return { action:'SENSITIVE_REQUEST',permission:'APPROVE_SPECIAL_PRICE' }
  if (/solo (ayudame|ayuda)|no le respondas.*ayudame/.test(t)) return { action: 'MODE', mode: 'ASSIST', target: target(/(?:con|a) (.+?)(?: pero|,|$)/) }
  if (/yo sigo (atendiendo|con)|no le respondas/.test(t)) return { action: 'MODE', mode: 'HUMAN_TAKEOVER', target: target(/(?:atendiendo a|respondas a|sigo con) (.+)/) }
  if (/vuelve a atender|atiende otra vez/.test(t)) return { action: 'MODE', mode: 'AUTO', target: target(/(?:vuelve a atender a|atiende otra vez) (.+)/) }
  if (/^pausa/.test(t)) return { action: 'MODE', mode: 'PAUSED', target: target(/^pausa (.+)/) }
  if (/puede registrar trabajos/.test(t)) return { action: 'PERMISSION', permission: 'CREATE_JOB', granted: true, target: target(/^(.+?) puede registrar trabajos/) }
  if (/quitale permiso.*registrar trabajos/.test(t)) return { action: 'PERMISSION', permission: 'CREATE_JOB', granted: false, target: target(/^quitale permiso a (.+?) para registrar trabajos/) === 'este chat' ? 'referencia pendiente' : target(/^quitale permiso a (.+?) para registrar trabajos/) }
  if (/este (chat|grupo).*(finanzas|proveedores|produccion|empleados)/.test(t)) {
    const purpose = /finanzas/.test(t) ? 'FINANCE' : /proveedores/.test(t) ? 'SUPPLIERS' : /produccion/.test(t) ? 'PRODUCTION' : 'EMPLOYEES'
    return { action: 'PURPOSE', purpose, target: 'este chat', ...(/grupo/.test(t) ? { role: 'INTERNAL_TEAM' } : {}) }
  }
  const tag = /proveedor/.test(t) ? 'PROVEEDORES' : /finanzas/.test(t) ? 'FINANZAS' : /spam/.test(t) ? 'SPAM' : /revision/.test(t) ? 'REVISION_HUMANA' : null
  if (tag && /marca|pasalo|pasala|quita|manda/.test(t)) return { action: 'TAG', tag, remove: /^quita/.test(t), target: target(/marca a (.+?) como/) }
  if (/registra (un|este) pedido para/.test(t)) {
    const match = /registra (?:un|este) pedido para ([^.]+)\.\s*(.+)/i.exec(text)
    if (!match) return { action: 'UNKNOWN' }
    const description = match[2]!, dims = /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/i.exec(description)
    const quantity = /(\d+|dos|tres|una|uno) unidades?/i.exec(description)
    const date = /para (?:el )?([^.,]+)/i.exec(description)?.[1]
    return { action: 'MANUAL_JOB', contactName: match[1]!.trim(), title: description.slice(0, 200), requirements: {
      customerRequest: description, ...(dims ? { width: Number(dims[1]!.replace(',', '.')), height: Number(dims[2]!.replace(',', '.')), widthUnit: null, heightUnit: null } : {}),
      ...(quantity ? { quantity: ({ dos: 2, tres: 3, una: 1, uno: 1 } as Record<string, number>)[quantity[1]!.toLowerCase()] ?? Number(quantity[1]) } : {}),
      ...(date ? { requestedDateText: date } : {}),
    } }
  }
  if (/trabajos pendientes|trabajos tenemos/.test(t)) return { action: 'VIEW_JOBS' }
  return { action: 'UNKNOWN' }
}
