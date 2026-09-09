# Joker — Understanding v2 y aprendizaje comercial supervisado

Fecha: 2026-09-09. Rama: `joker-agent-core-avance`. Implementación local, sin despliegue.

## Alcance y límites de autoridad

El intérprete describe el pedido; no decide permisos, herramientas, precios, pagos ni
publicaciones. Las reglas vigentes de producto y el workflow de aprobación mantienen la
autoridad comercial. Una referencia del dueño o una cotización antigua NO es una tarifa actual.

Se conserva el buffering, los leases y recibos de AgentTurn, las políticas de actores y el
outbox. No se activaron OpenAI, Meta, audio, SUNAT ni bases de producción.

## Turnos y continuidad

`synthesizeTurn` valida un máximo de 60 mensajes con el mismo chat, remitente y origen,
rechaza identificadores repetidos y conserva el orden por fecha e identificador. Texto,
imagen y documento son parte del mismo turno; no se genera una respuesta por burbuja.
La síntesis, Understanding v2 y la decisión quedan persistidos en AgentTurn. Recuperar un
turno con plan guardado reutiliza ese plan, sin reinterpretarlo ni duplicar efectos.

El intérprete indica COMPLETE, LIKELY_INCOMPLETE, WAITING_FOR_FILE o WAITING_FOR_MORE_TEXT.
Los turnos incompletos no generan salida al cliente: Conversation conserva pendingSynthesis,
waitingState y waitingUntil. El mantenimiento del procesador pasa a WAITING_CUSTOMER después
de cinco minutos, sin descartar el contexto. El archivo posterior del mismo remitente/origen
reanuda la síntesis. Un único trabajo compatible puede continuar; varios trabajos requieren
aclaración. No se infiere que una imagen sea autorización de arte final.

Las relaciones son ADD, CLARIFY, CORRECT, REPLACE, CONFIRM y CANCEL. Las entidades finales
son únicas por clave; «quiero 20 / no, mejor 30» produce quantity=30 antes del cálculo.
La cancelación es intención, no una orden de cancelar automáticamente un trabajo.

## Contrato Understanding v2

Schema Zod estricto, sin campos adicionales ni tools:

- primaryGoal y secondaryGoals: las 26 familias solicitadas, desde DISCOVERY hasta UNKNOWN.
- entities: hasta 60 pares clave/valor, claves de requisitos autorizadas y sin duplicados.
- commercialSignals, objections y friction: dimensiones independientes.
- urgency, purchaseIntent, priceRequest, deadlineRequest y availabilityRequest.
- specialProductCandidate, needsClarification, needsHuman, securitySignals y confidence.
- turnCompleteness, productResolution, requestComponents y messageRelations.

El adapter determinista tiene heurísticas temporales aisladas. No reconoce exhaustivamente
todas las expresiones de cada familia: el contrato permite ampliarlas o sustituir el adapter.
OpenAIInterpreterTransport implementa interpretTurn con Structured Outputs, store=false y
sin tools; sus pruebas usan exclusivamente un SDK simulado. El preflight sigue usando el
adapter determinista: este bloque NO activa automáticamente el transporte OpenAI v2.

`interpretSafely` valida schema y referencias de mensajes y reconstruye las capacidades
desde datos del tenant. Una salida inválida, refusal o error devuelve UNKNOWN seguro.

## Productos y componentes

Resoluciones: EXACT, VARIANT, COMPOSITE, SPECIAL, POSSIBLE_OUTSOURCING, UNKNOWN, NOT_OFFERED.
No encontrar un producto no autoriza afirmar que no se ofrece. NOT_OFFERED requiere un
indicador explícito en las capacidades verificadas del negocio.

Las capacidades son datos (key, aliases, componentes y vínculos opcionales a producto y
configuración), no ramas por nombre dentro del dominio. Las referencias verificadas de
categoría CAPABILITY amplían el vocabulario sin conceder APPROVED_RULE. Solo una configuración
vigente validada de producto concede esa condición. La descomposición permite, por ejemplo,
impresión + MDF + corte + montaje, incluso sin producto compuesto exacto.

Los compuestos requieren evaluación; no se suman automáticamente precios parciales para
inventar un total. Se crea Job genérico cuando es inequívoco y OwnerReview con razón
COMMERCIAL_KNOWLEDGE_REQUIRED y Task CHECK_PRODUCT_RULE. Una clave por trabajo/componentes
evita revisiones repetidas. Los detalles internos incluyen referencias y la pregunta comercial.

## SalesPolicyEngine y fallback

Decisiones: CAN_ANSWER, CAN_ACT, NEEDS_CLARIFICATION, NEEDS_APPROVAL,
NEEDS_OWNER_KNOWLEDGE, NEEDS_HUMAN y UNKNOWN. Devuelve acciones permitidas/bloqueadas,
siguiente objetivo, preguntas, flags de revisión, safeClaims y forbiddenClaims.

PAUSED/HUMAN_TAKEOVER bloquean envío y herramientas; ASSIST conserva sugerencias internas.
Los controles existentes de actor/seguridad siguen ejecutándose antes de actuar y al enviar.
Job, tasks y approvals están previstos en el contrato; sus transiciones y autorizaciones
siguen en el workflow existente, no en el intérprete. La política no sustituye esos guards.

Referencias e históricos se contabilizan como REFERENCE_ONLY. Nunca habilitan SEND_HISTORICAL_PRICE,
PUBLISH_RULE ni CONFIRM_PAYMENT. Fricción reduce la interacción a una pregunta por vez;
no equivale a objeción. Una petición de precio no implica automáticamente PRICE_TOO_HIGH.
Fallback: aclaración mínima, referencias internas, revisión del dueño o humano; nunca importe
inventado ni rechazo por simple ausencia de coincidencia. Aún no hay ResponseGenerator completo.

## Conocimiento persistente y aprendizaje

CommercialKnowledge incluye tenant, título, categoría, componente, scope, status, fuente,
trabajo/cotización opcionales, actores creador/verificador, fechas, contenido, aplicabilidad,
riesgo y requestKey idempotente. Estados: DRAFT, VERIFIED_REFERENCE, REJECTED, SUPERSEDED.

1. Una fuente TEXT de OWNER verificado propone conocimiento vinculado al caso.
2. Se guarda DRAFT con scope NULL, incluso si la frase sugiere un alcance.
3. El dueño confirma THIS_JOB, REUSABLE_REFERENCE o PERMANENT_RULE_CANDIDATE.
4. Se audita la revisión y conserva la fuente. No se modifica ProductConfiguration ni PriceRule.

THIS_JOB solo se recupera para el trabajo indicado. REUSABLE_REFERENCE sirve para revisión
de casos similares. Los candidatos permanentes quedan fuera de la recuperación de precios.
La aplicabilidad (materiales/configuración) acompaña la referencia para revisión humana;
no se supone aplicable automáticamente por compartir componente.

Adapter inicial para el chat privado del OWNER:

```text
conocimiento para revision <UUID de OwnerReview>: esta vez cobra 400
alcance <UUID de CommercialKnowledge> solo este trabajo
alcance <UUID de CommercialKnowledge> referencia reutilizable
alcance <UUID de CommercialKnowledge> regla permanente
```

Solo se ejecuta una confirmación por borrador. Frases libres sin un identificador inequívoco
no se asocian automáticamente a un caso. El importe extraído es explicación del dueño, no
una cotización autorizada. Confirmaciones concurrentes quedan serializadas y auditadas una vez.
Cliente, simulación, documento y empleado sin rol OWNER no pueden crear referencias como dueño.
No se añadió endpoint público ni panel administrativo para estas operaciones.

## Históricos y sugerencias

`historical()` consulta hasta 200 trabajos recientes con Quote APPROVED dentro del tenant,
compara producto/componentes y requisitos estructurados (material, dimensiones, configuración,
tags) y devuelve hasta 10 referencias con razones de similitud. No usa el título como criterio.
La comparación dimensional actual es literal: normalizar unidades entre históricos es mejora
posterior, no se promete equivalencia entre 80 cm y 0.8 m en esa búsqueda.

Las referencias se adjuntan solamente al OwnerReview/Task interno. approvedTotal histórico
no aparece en el plan de respuesta al cliente como precio actual.

CommercialRuleSuggestion agrupa explicaciones y aplicabilidad idénticas de referencias
verificadas reutilizables. Requiere al menos tres trabajos distintos, no tres repeticiones
del mismo caso. Guarda evidencias y dedupeKey; OWNER puede aprobar/rechazar. Aprobar la
sugerencia tampoco publica reglas. Agrupación semántica y edición natural quedan pendientes.

## PDF comercial realmente revisado

Fuente: `C:/Users/Fernando/Downloads/Base_Conocimiento_Cotizador_Joker.pdf`, cuatro páginas
extraídas e inspeccionadas visualmente. SHA-256:
`f26114478569ec23b9aa9af28d0f177392eea11113bfca0068e75c35947bf609`.

`joker-pdf-reference.fixtures.ts` conserva tarifas, capacidades y gaps como datos revisables.
CommercialKnowledgeService.propose acepta sourceDocument con nombre, hash y contenido para
persistirlos como PDF_REFERENCE, siempre con OWNER verificado y posterior confirmación.
La integración PostgreSQL prueba esa persistencia. NO se importó el PDF en la BD del negocio
ni se activaron tarifas; los fixtures no son un seed productivo automático.

- Letras: tarifa por cm de altura, distinta por acabado. Alturas diferentes se prueban por
  componente; agregar líneas heterogéneas en la cotización final requiere revisión/otro bloque.
- Bastidor: S/160/m², sin mínimo inventado. Instalación separada.
- Letreros terminados: tarifas del documento con mínimo facturable 1 m² por pieza.
- Banner 7 oz: S/6/m² únicamente sobre 100 m²; hasta 100 devuelve RULE_NOT_CONFIGURED.
- Vinil: tarifa lineal; falta ancho útil/aprovechamiento. No se convierte un área en consumo
  lineal optimizado sin esa regla. El fixture LINEAR genérico no autoriza tal inferencia.
- Impuestos: el PDF no especifica tratamiento. taxRate=0 en fixtures es supuesto de cálculo
  de fabricación para pruebas, NO una conclusión fiscal ni una tarifa publicable.
- Costos de insumos de fabricación no se confunden con precios de venta al cliente.

El motor genérico agrega minimumMeasure y minimumOrderMeasureExclusive; conserva medida
física y aplica mínimo facturable al cálculo. No agrega ifs por nombre de producto.

Instalación queda INSTALLATION_REVIEW_REQUIRED: ubicación, altura, acceso, riesgo, personal,
escalera/andamio, equipo y dificultad. La falta de tarifa de instalación no invalida calcular
fabricación por separado. VISUAL_REFERENCE != FINAL_ARTWORK permanece explícito en policy.

## Verificación y archivos

Nuevos: understanding-v2.ts, deterministic-understanding.ts, understanding-preflight.ts,
sales-policy-engine.ts, commercial-knowledge.service.ts, owner-commercial-learning.ts,
joker-pdf-reference.fixtures.ts, understanding-v2.spec.ts, commercial-learning.integration.spec.ts
y este documento. Archivos TypeScript bajo server/src/agent-core.

Modificados: schema.prisma, agent-core.module.ts, agent-turns.service.ts, commercial-pricing.ts,
conversation-controls.ts, openai-interpreter.transport.ts, openai-interpreter.spec.ts,
sales-agent.service.ts, commercial-flow.integration.spec.ts, whatsapp-processor.service.ts
y JOKER_IMPLEMENTATION.md. Prisma agrega dos modelos de conocimiento/sugerencia, dos enums
de alcance/estado, relaciones Tenant y campos de síntesis/espera/decisión. Schema aplicado
únicamente al PostgreSQL aislado; la migración del negocio requiere revisión y autorización.

La matriz parametrizada tiene 500 conversaciones; no son 500 ramas del core. Se agregan
casos de PostgreSQL, mocks, mínimos PDF, seguridad, aislamiento, recuperación y aprendizaje.
El resultado final y comandos quedan en JOKER_IMPLEMENTATION.md. npm test sin TEST_DATABASE_URL
omite las suites PostgreSQL por seguridad; la validación completa usa el script aislado y
debe reportar cero omitidas. No se eliminaron pruebas previas.

## TODO deliberados

Activar transporte v2 con autorización y evaluaciones de lenguaje real; publicación revisada
de tarifas; importación aprobada del PDF al negocio; migración productiva; panel y notificación
proactiva al dueño; generación natural de respuestas y edición de sugerencias; agregación de
cotizaciones heterogéneas; mejor similitud histórica; cierre automático supervisado de tareas
tras resolver conocimiento. Ni guardar referencia ni aprobar scope reanuda automáticamente
una cotización o da por resuelta la falta de una regla publicada.

Fuera de alcance: audio real, DesignSession completo, Supplier sourcing completo, SUNAT,
Meta real, llamadas OpenAI con créditos, Railway y deploy. El working tree se entrega para
revisión, sin commit ni push. No presentar este bloque como lanzamiento a producción.
