# Joker: actores, seguridad y automatización

Bloque local del 2026-09-08. Rama `joker-agent-core-avance`.
No activa OpenAI, Meta, audio, SUNAT, Railway ni despliegues. No publica cambios.

## Identidad y bootstrap

`ActorIdentity` vincula tenant, canal, sujeto externo y ContactProfile. Guarda tipo,
estado activo, permisos, quién verificó y cuándo. El número configura la identidad;
el nombre del mensaje o del chat nunca la acredita.

En `.env.example`: `OWNER_BOOTSTRAP_NAME=Joel Mancilla` y
`OWNER_BOOTSTRAP_PHONE=51960416178`. La entrada nacional `960416178` se normaliza
al mismo número. No hay teléfono del dueño incrustado en el motor comercial.

Para una base LOCAL de desarrollo, después de revisar/aplicar el cambio de esquema
y configurar DATABASE_URL y DEFAULT_TENANT_ID en el entorno del servidor:

```powershell
npx tsx scripts/bootstrap-owner.ts --confirm-local-owner
```

Ejecutar desde `server`. El comando exige host de BD local, datos explícitos y el
flag de confirmación. No se ejecuta al iniciar la aplicación. Es idempotente y
rechaza reemplazar silenciosamente al propietario. Se probó en la base aislada;
no se ha ejecutado contra la BD comercial ni producción en esta entrega.

`ConversationMessage` registra `authorType`, `authorId`, `senderExternalId` y
`source`. El preflight resuelve nuevamente la identidad activa. Un mensaje simulado,
histórico UNVERIFIED o un texto “soy Joel” nunca autentica al dueño.
El webhook solo marca VERIFIED_WEBHOOK después de validar la firma en modo cloud.
El endpoint simulate no está disponible cuando WHATSAPP_MODE=cloud.
Las salidas de la cola se registran como AI_AGENT / AGENT_OUTBOX.

Actores: CUSTOMER, OWNER, EMPLOYEE, SUPPLIER, SYSTEM, AI_AGENT. Los tres últimos
no obtienen permisos administrativos por su tipo. Los adaptadores internos no deben
aceptar authorId/source/role arbitrarios desde JSON público.

## Empleados y cola del propietario

Una solicitud interna de un remitente no autorizado genera `OwnerReview` y una
`Task CONTACT_CUSTOMER`, vinculadas al mensaje y conversación. Detalles incluyen
el sujeto externo, actor conocido y `probableInternalActor`. Se deduplican intentos
de empleado por sujeto dentro del tenant; eventos de seguridad por mensaje.

La aprobación exige OWNER activo y candidato proveniente de webhook verificado.
Una simulación no permite verificar empleados. Se crea ContactProfile INTERNO e
identidad EMPLOYEE con `verifiedBy`, `verifiedAt` y permisos base. Rechazar no crea
identidad. Decisiones repetidas son idempotentes; decisiones contradictorias fallan.
Las aprobaciones concurrentes se serializan y no crean dos identidades.

Desde el canal privado del dueño:

```text
Joker, lista revisiones pendientes
aprueba empleado revision <UUID de OwnerReview>
rechaza empleado revision <UUID de OwnerReview>
ignora revision <UUID de OwnerReview>
marca valido revision <UUID de OwnerReview>
```

El UUID debe identificar una revisión del mismo tenant. No se adivina a qué revisión
corresponde un “sí”. Las decisiones BLOCK/IGNORE/KEEP_ACTIVE/MARK_VALID se registran;
BLOCK no llama a Meta ni bloquea automáticamente el número. Resolver una revisión
no reactiva por sí solo el chat: el dueño debe ordenar volver a AUTO.
No hay panel nuevo ni notificaciones reales proactivas a WhatsApp en este bloque.

## PermissionPolicy persistente

`ActorPolicy.employeeBasePermissions` configura permisos iniciales. Por defecto:
VIEW_JOBS, CREATE_JOB, UPDATE_REQUIREMENTS. Cambiar la base no concede permisos
retroactivos a empleados ya aprobados. `ActorIdentity.permissions` determina los
permisos efectivos de cada empleado; OWNER activo tiene todos.

Catálogo: VIEW_JOBS, CREATE_JOB, UPDATE_JOB, UPDATE_REQUIREMENTS, CREATE_QUOTE,
VIEW_QUOTES, SEND_QUOTE, CREATE_DOCUMENT, VIEW_INTERNAL_FINANCE,
REGISTER_PAYMENT_REPORT, CONFIRM_PAYMENT, APPROVE_QUOTE, APPROVE_SPECIAL_PRICE,
CHANGE_PRODUCT_RULE, MANAGE_EMPLOYEES, MANAGE_PERMISSIONS,
CHANGE_AUTOMATION_MODE, MANAGE_TAGS, MANAGE_INTERNAL_CONVERSATIONS.

`OperatorControlsService.execute(sourceMessageId, command)` es la entrada interna
autorizada. No hay controlador público para invocarla con un actor inventado.
Valida fuente persistida, tipo TEXT, identidad activa, permiso y tenant antes de actuar.
Los comandos son contratos Zod estrictos; requisitos de trabajos no aceptan campos
como paymentConfirmed, descuentos o permisos ocultos.

Frases disponibles:

```text
Fernando puede registrar trabajos
quítale permiso a Fernando para registrar trabajos
quítale permiso para registrar trabajos
```

La última solo usa el empleado previamente identificado por una orden autorizada
en ese chat. Sin referencia inequívoca pide aclaración. Solicitudes “confirma pago”
de empleados sin permiso se deniegan. Incluso con permiso, una frase sin trabajo,
evidencia y aprobación no confirma pagos ni altera precios. Las aprobaciones del
motor comercial anterior conservan sus propias restricciones; no se sustituye
su revisión por confianza del modelo ni se habilitan comandos financieros libres.

Las rutas HTTP antiguas de aprobación de cotización, lectura de conversaciones y
envío manual de cotización ahora requieren un bearer privado `OPERATOR_API_TOKEN`
de al menos 32 caracteres y OWNER activo. Vacío significa deshabilitado. No incluir
esa credencial en la landing ni en JavaScript del navegador. Es un puente privado
para operadores, no un sistema nuevo de login para empleados.

## Modos, roles y propósito

Los modos son por conversación:

| Modo | Comportamiento |
| --- | --- |
| AUTO | Flujo comercial habitual sujeto a políticas y aprobaciones. |
| ASSIST | Interpretación heurística y sugerencia interna; sin respuesta al cliente ni herramientas comerciales automáticas. |
| HUMAN_TAKEOVER | Conserva mensajes e interpretación para el operador; no responde al cliente. |
| PAUSED | Registra autor/mensaje y completa el turno en silencio, sin tareas ni interpretación comercial. Acepta reanudación explícita autorizada. |

Un mensaje manual humano NO cambia el modo. Solo una orden autorizada o la política
explícita de revisión de seguridad lo cambia. HUMAN_TAKEOVER no es un bloqueo global.

```text
yo sigo atendiendo a Rosa
no le respondas a Rosa
solo ayúdame con Rosa pero no le escribas
vuelve a atender a Rosa
pausa este chat
atiende otra vez este chat
```

Los nombres deben resolver exactamente un chat en el tenant. Si hay varias Rosas o
una referencia sin destino identificable, se pide aclaración y no se modifica nada.

Roles: CUSTOMER, OWNER_PRIVATE, INTERNAL_TEAM, SUPPLIER. El canal directo del dueño
se reconoce por identidad verificada, nunca por llamarse “Joel”. El resto se clasifica
con la orden/contrato autorizado. Propósitos: SALES, FINANCE, SUPPLIERS, EMPLOYEES,
PRODUCTION, DESIGN, PURCHASES, GENERAL, HUMAN_REVIEW, SECURITY, OTHER.

“Este chat úsalo para finanzas” cambia propósito; “este grupo es de proveedores”
lo clasifica INTERNAL_TEAM / SUPPLIERS y lo deja en ASSIST. Cambiar rol no otorga
permisos a participantes. El identificador externo de conversación es independiente
de la identidad del remitente almacenada en cada mensaje.

INTERNAL_TEAM registra observaciones como “de esta factura falta bancarización” en
una tarea deduplicada sin responder innecesariamente. Una mención o pregunta de
personal verificado puede recibir acuse. Los listados sensibles se entregan solo
en OWNER_PRIVATE. La interpretación libre de “grupos de WhatsApp” y su transporte
real no se implementan: este bloque prueba el contrato interno de conversaciones.

## Etiquetas

`InternalTag` y `TagAssignment` permiten múltiples etiquetas por contacto o chat:
CLIENTES, FINANZAS, PROVEEDORES, EMPLEADOS, VENTAS, DISEÑO, PRODUCCION, OTROS,
REVISION_HUMANA, SEGURIDAD, SPAM. No dependen de etiquetas de Meta.

Comandos internos TAG y LIST_TAGS; TAG admite exactamente uno de contactProfileId o
conversationId. Agregar es idempotente y quitar una no elimina las otras. LIST_TAGS
lista las de un chat. “Marca a Carlos como proveedor” busca un contacto único y,
si no existe, un chat único; “pásalo a proveedores”, “pásalo a finanzas”, “quita spam”
y “manda a revisión” operan sobre el chat actual. No se adivina otra conversación.

## Seguridad

Clasificaciones: OUT_OF_SCOPE, OUT_OF_SCOPE_REPEAT, SPAM_SUSPECTED,
PROMPT_INJECTION_ATTEMPT, SOCIAL_ENGINEERING_ATTEMPT, OWNER_IMPERSONATION,
UNAUTHORIZED_INTERNAL_REQUEST, SUSPICIOUS_CONTENT, ABUSIVE_CONTACT.

Clasificación determinística simple, no detector universal. Los permisos estrictos
y la separación de herramientas son la protección incluso si no reconoce una frase.
Texto de imágenes/documentos no se ejecuta como orden de operador.

Un primer fuera de tema recibe orientación comercial normal. El contador se guarda
en la conversación; `ActorPolicy.outOfScopeThreshold` vale 4 por defecto y es
configurable en la política persistida. Al alcanzar el umbral se crea revisión y se
limita AUTO a ASSIST. Una vuelta comercial reconocida reinicia el contador, pero no
reactiva respuestas sin orden del dueño. Casos graves no esperan cuatro mensajes.
No se elimina ni bloquea automáticamente al contacto.

## Pedidos manuales y documentos

```text
Joker, registra un pedido para Comercial Torres. Banner 3x2, dos unidades, para el viernes.
```

Crea Job MANUAL_OPERATOR, createdBy e información parcial. Un contacto nuevo puede
tener solo nombre: `ContactProfile.phone` ahora es nullable. No se inventa teléfono,
unidad de medida, fecha calendario, precio ni cotización. Si el nombre coincide con
varios contactos, se pide aclaración. Escribir requisitos requiere también
UPDATE_REQUIREMENTS. Los clientes externos no pueden usar esta entrada de operador.

`BusinessDocument`: tenant, job, customer opcional, type, status, templateKey,
snapshot, createdBy, createdAt, requestKey idempotente. Tipos COTIZACION, BOLETA,
FACTURA, ORDEN, COMPROBANTE_INTERNO. El contrato crea DRAFT con advertencia de no
emisión tributaria. Los estados DOCUMENT_GENERATED y TAX_DOCUMENT_ISSUED están
separados. Ninguna acción de este bloque puede marcar TAX_DOCUMENT_ISSUED.

La estructura PDF existente es `server/src/quotes/quote-pdf.service.ts`; se referencia
como `quote-pdf-v1` para cotizaciones. Otros documentos conservan un contrato interno
`internal-document-v1`, no una plantilla gráfica nueva ni un PDF emitido.

## Durabilidad y auditoría

Preflight bajo transacción antes del intérprete comercial y antes de generar outbox.
Turnos no mezclan remitentes/fuentes diferentes. El plan de control se persiste junto
con sus efectos. Las órdenes directas marcan el mensaje consumido para que el worker
no lo mezcle otra vez con la orden siguiente.

Las operaciones administrativas serializan por tenant; turnos bloquean tenant,
conversación y turno en ese orden. Se prioriza consistencia en este volumen inicial.
Los recibos de órdenes usan AuditLog y sourceMessageId; no se agrega otra cola.
Un replay con argumentos diferentes se rechaza. Se registran actor, acción, destino,
before/after, razón, fuente y timestamp. Las fuentes simuladas no se vuelven confiables
por tener authorType escrito previamente.

El outbox revisa modo al crear y al reclamar envíos pendientes. Revalida permisos de
listados internos antes del despacho. Si hay atención humana cancela lo pendiente;
un envío ya reclamado/en vuelo no se puede retirar del proveedor. Se conserva el
tratamiento UNCERTAIN: no se reintenta a ciegas ni se duplican confirmaciones.
La entrega antigua de cotizaciones también revisa el modo.

## Validación y siguientes bloques

Resultado local: **329 tests aprobados, 0 omitidos**, 22 archivos, con PostgreSQL
aislado. Se añadieron 42 tests unitarios/contratos y 46 de integración (88 nuevos).
Build, typecheck, Prisma validate/generate y diff --check correctos.

Pruebas nuevas: `actor-policy.spec.ts` y `actors-security.integration.spec.ts`.
Se preservan las 241 anteriores. Las fixtures antiguas solo se adaptaron al nuevo
paso de preflight y al resultado nullable de un turno silencioso; no se quitaron tests.

Ejecutar desde server: `npm run build`, `npm run lint`, `npm test`,
`npx prisma validate`, `npx prisma generate`. `npm test` sin TEST_DATABASE_URL
omite deliberadamente las suites que necesitan PostgreSQL; la validación completa
se realiza con el script aislado existente. Ese script crea únicamente
127.0.0.1:55439/joker_core_test y lo detiene al terminar. APIs externas bloqueadas.

Pendientes deliberados fuera de este bloque:

- Revisar migración y bootstrap contra la BD destino; no se aplicaron a producción.
- Adaptador real de grupos, notificaciones proactivas y UI/login de operadores.
- Emisión/renderizado de documentos adicionales y cualquier integración SUNAT.
- APIs reales de OpenAI/Meta/audio, sourcing y DesignSession completos.
- Antes de desplegar, completar autenticación/autorización de todo el API antiguo
  (catálogos, archivos y vistas de cotizaciones) y revisar acceso por cliente.
  El guard añadido aquí no convierte el API histórico entero en multiusuario seguro.
- Para escala mayor, sustituir serialización por tenant por bloqueos más finos tras
  mantener las mismas pruebas de aislamiento, orden y recuperación.

## Archivos de este bloque

Nuevos: actor-policy.ts, actor-policy.spec.ts, owner-instruction-interpreter.ts,
operator-controls.service.ts, conversation-controls.ts, actors-security.integration.spec.ts
(server/src/agent-core); common/operator-api.guard.ts; scripts/bootstrap-owner.ts;
este documento.

Modificados: schema.prisma, .env.example, AgentCoreModule, AgentTurnsService,
AgentOutboxService, SalesAgentService, CommercialService, CommonModule,
QuotesController, WhatsAppController/Conversations/Processor/Delivery y las fixtures
commercial.integration, whatsapp-agent-core y whatsapp-buffering; JOKER_IMPLEMENTATION.md.

El árbol queda sin commit ni push para revisión del propietario.
