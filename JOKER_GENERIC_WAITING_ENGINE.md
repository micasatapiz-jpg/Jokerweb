# Joker — Generic Waiting Engine

Implementación local del bloque de espera durable. Rama: `joker-agent-core-avance`.
Sin despliegue, Railway, producción, seeds ni llamadas a OpenAI/WhatsApp reales.

## Arquitectura

El buffering existente agrupa burbujas. Después de los controles de actor y seguridad,
la interpretación estructurada se correlaciona con esperas concretas. Un mensaje
ajeno a la espera no impide que otra intención siga su recorrido normal.

`Mensaje → buffering/seguridad → interpretación → evento correlacionado → worker → reevaluateWait → persistencia parcial o resume → siguiente paso`

- `waiting-engine.ts`: decisión pura con siete resultados: NOT_RELATED,
  PARTIALLY_SATISFIED, SATISFIED, UPDATED, SUPERSEDED, STILL_WAITING y
  REQUIRES_HUMAN_REVIEW. Este último protege contra condiciones durables inválidas.
- `AgentOrchestratorService`: conserva locks Event → Workflow, controles de
  empleado, aprobación, revisión del Job, modo de conversación y recibos atómicos.
  Progreso parcial y consumo del evento se confirman en la misma transacción.
- `WaitFollowUpService`: crea solamente tareas internas CHECK_REQUIREMENT.
  Efecto y contador se confirman juntos bajo lock. La clave es
  `wait-follow-up:<epoch>:<ordinal>` y el worker lo ejecuta después de los eventos.
- Adaptador de cotización: reutiliza `QuoteWorkflowService.saveRequirements`
  dentro de la misma transacción para validar campos configurados, conservar
  auditoría y cambiar revisiones. No escribe directamente precios ni pagos.

## Persistencia sin migración

Se reutilizan AgentWorkflow, AgentWorkflowStep, AgentEvent y Task.
Los IDs de tenant/job/conversación, actor esperado, motivo, correlationKey y
resumeCondition ya existen. `contextJson.waiting` agrega un contrato validado:

| Campo | Función |
| --- | --- |
| epoch | Identifica la generación de la espera; evita respuestas para otra espera |
| startedAt / status | Inicio y resultado durable |
| values / fields / evidence | Aportes parciales y tipo de archivo recibido |
| nextCheckAt | Próximo seguimiento; separado de wakeAt/WAITING_TIME |
| followUpCount / policy | Presupuesto, intervalos y backoff |
| resumeCurrentStep | Reejecutar CHECK_POLICY, sin saltárselo ni reiniciar attempts |
| reason | Motivo de sustitución, revisión o invalidación del seguimiento |

Los IDs de mensajes, valores de cada aporte y su correlación permanecen en
AgentEvent. La evidencia recibida no implica archivo aprobado ni conocimiento
comercial ejecutable.

## Uso interno

`AgentOrchestratorService.wait(id, {..., followUp: {}})` habilita el seguimiento
predeterminado: primero a las 24 horas, segundo 48 horas después del primero,
máximo dos tareas. Se pueden configurar `firstDelayMs`, `secondDelayMs`, `backoff`
y `maxFollowUps`. Omitir followUp deshabilita recordatorios en un WAIT genérico.
Las esperas comerciales nuevas sí habilitan esos valores predeterminados.

No se envía ningún mensaje. Antes de crear tareas se releen estado, modo AUTO,
revisión del Job, datos aún faltantes, eventos pendientes y mensajes BUFFERED.
Una revisión distinta desactiva ese recordatorio con FOLLOW_UP_CONTEXT_CHANGED;
no se supone que el objetivo anterior siga vigente. Satisfacer/sustituir una espera
cierra sus tareas de seguimiento ya creadas.

Los adaptadores internos pueden emitir un evento explícitamente dirigido a un
workflow con `payload.waitInput: true`, `values` y `waitEpoch`. El actor lo obtiene
el adaptador del contexto autenticado, nunca del texto del cliente.

## Cotizaciones e invariantes

- QUOTE_READINESS con MISSING_DATA vuelve a WAITING_CUSTOMER en el mismo workflow
  y currentStep. No consume ni reinicia intentos técnicos.
- Una respuesta completa vuelve a ejecutar CHECK_POLICY antes de RETRY_QUOTE_DRAFT.
- El camino WAITING_OWNER → COMMERCIAL_KNOWLEDGE_VERIFIED → CHECK_POLICY →
  RETRY_QUOTE_DRAFT → PENDING_APPROVAL se conserva y está cubierto por hardening.
- CUSTOMER no satisface OWNER. EMPLOYEE sigue necesitando permiso persistido.
- Referencias verificadas y aportes del proveedor no crean ProductConfiguration,
  PriceRule, aprobación de cotización, pago confirmado ni inicio de producción.
- Los modos ASSIST/HUMAN_TAKEOVER/PAUSED siguen bloqueando continuación automática.
- Una sustitución explícita de referencia por producto activo cancela el workflow
  de espera de foto del cliente. No aprueba ni cotiza automáticamente el reemplazo.
- Una reanudación manual autorizada crea una generación nueva de espera y no
  reutiliza una generación ya satisfecha.

## Pruebas y verificación

`generic-waiting.integration.spec.ts` agrega 19 pruebas PostgreSQL reales:

- A/M: consulta no relacionada y otro workflow procesable en la misma conversación.
- B/G/N: medidas interpretadas, evento correlacionado, dos réplicas, una reanudación
  y siguiente paso completado.
- C: medidas parciales persistidas, reinicio del servicio y cantidad posterior.
- D: sustitución de foto por producto activo; una imagen tardía no reactiva el WAIT.
- E: CUSTOMER no satisface OWNER.
- F: dos esperas distintas, solo la relevante se reanuda.
- H/J: timer duplicado, concurrencia, presupuesto y límite de recordatorios.
- I: respuesta pendiente o consumida antes del timer evita seguimiento.
- K: fallo después de insertar la tarea y antes del contador revierte la transacción;
  retry/replay crea una sola tarea.
- L: QUOTE_READINESS incompleto → mismo paso → datos → política → draft pendiente.
- Adicionales: revisión obsoleta, corrección parcial, datos repetidos, epoch anterior,
  condición corrupta, hechos ya completos, cierre de tareas previas, proveedor sin Job,
  aislamiento de tenants y mensaje correlacionado duplicado.

Ejecución segura desde `server`:

```powershell
npm run build
npm run lint
node scripts/isolated-postgres-tests.mjs C:/Users/Fernando/AppData/Local/Temp/joker-pg-test-c85f3d84-7341-44ca-a4be-f1dad510f0dc
```

El script crea un clúster temporal, usa `joker_core_test` en loopback, vacía claves
de API, ejecuta la suite y detiene el clúster al terminar. No utiliza la BD normal.
El build del frontend se ejecuta con `npm run build` desde la raíz.

## Riesgos y límites explícitos

- No hay generación lingüística final, transporte de seguimientos ni UI nueva.
- El correlador automático no adivina entre dos Jobs activos ni entre esperas que
  solicitan el mismo campo/archivo. Es necesario desambiguar y dirigir el evento.
- La interpretación local reconoce medidas/cantidad y sustitución por un producto
  del catálogo. Materiales, unidades expresadas aisladamente y aclaraciones libres
  siguen dependiendo de los adaptadores de interpretación existentes; el motor
  acepta sus entidades estructuradas, no promete comprensión lingüística universal.
- Las esperas de OWNER por conocimiento no se cancelan por afirmaciones no
  verificadas del cliente. La sustitución automática implementada corresponde a
  la espera de foto del CUSTOMER, no al cierre unilateral de revisiones del dueño.
- El adaptador de cotización guarda campos definidos en ProductConfiguration.
  Los datos del ContactProfile deben seguir entrando por su flujo específico;
  no se convierten arbitrariamente en requisitos comerciales.
- Ante Job revisado, el recordatorio viejo se suspende de forma conservadora.
  El flujo de requisitos/resume debe volver a evaluar el objetivo vigente.
- nextCheckAt se consulta en JSON antes de aplicar LIMIT. Para gran volumen puede
  necesitar un índice de expresión; no se introdujo una migración prematura.
- Se conserva pg 8. La suite existente emite un aviso de deprecación relativo a
  consultas concurrentes para una futura pg 9; no se actualizó esa dependencia.

## Lista exacta de archivos de este bloque

Nuevos:

1. `server/src/agent-core/waiting-engine.ts`
2. `server/src/agent-core/wait-follow-up.service.ts`
3. `server/src/agent-core/generic-waiting.integration.spec.ts`
4. `JOKER_GENERIC_WAITING_ENGINE.md`

Modificados:

1. `server/src/agent-core/agent-core.module.ts`
2. `server/src/agent-core/agent-event-worker.service.ts`
3. `server/src/agent-core/agent-orchestrator.service.ts`
4. `server/src/agent-core/agent-orchestrator.ts`
5. `server/src/agent-core/commercial-wait-workflow.ts`
6. `server/src/agent-core/customer-resume-events.ts`
7. `server/src/agent-core/deterministic-understanding.ts`
8. `server/src/agent-core/workflow-operations.service.ts`
9. `server/src/agent-core/workflow-step-runner.service.ts`

No se editaron esquema Prisma, dependencias, lockfiles, variables secretas ni frontend.
