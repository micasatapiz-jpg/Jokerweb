# Joker IA — avance y criterios de cierre

> **Checkpoint comercial previo a OpenAI/deploy, 2026-09-08:** 241 pruebas aprobadas,
> 0 omitidas con PostgreSQL aislado (206 unitarias/contratos + 35 integración, 20 archivos).
> Herramientas conectadas al plan durable, cinco modalidades genéricas, intérprete OpenAI
> preparado con mocks. No desplegado. Consultar la sección final de este bloque; las
> secciones anteriores conservan el historial y sus limitaciones al momento de cada entrega.

> Actualización local posterior al contexto entregado el 2026-09-08: el puente de texto
> ya usa el intérprete heurístico aportado y turnos persistentes; se añadió el worker de
> salida. Ver «Continuación: puente de texto y despacho» al final. Esto no significa
> que las 40 fases ni la cotización automática estén terminadas o desplegadas.

## Alcance vigente

Se implementan conjuntamente los documentos del usuario: contexto completo (40 fases),
anexo de reglas/archivos y extensión de aprendizaje controlado. Ningún ejemplo de precio,
plazo, formato o condición del documento se considera una regla comercial activa.

Estado externo aportado por el propietario: Railway/Postgres/webhook operativos;
web pública; política de privacidad existente; recepción WhatsApp persistida;
OpenAI pendiente de crédito. No reabrir esos diagnósticos. Rama inicio-scroll-unificado.

No consumir OpenAI ni cargar saldo durante desarrollo. No ejecutar seed demo en producción.
No activar llamadas. No modificar PostgreSQL producción sin revisar y respaldar el cambio.

## Evidencia de avance (2026-09-08)

| Fases | Implementación | Validación / lo que falta |
| --- | --- | --- |
| 1 | Revisado schema actual; ampliación aditiva sin borrar tablas ni columnas | prisma validate y generate correctos; producción no modificada |
| 2 | ContactProfile independiente de Customer/Job, teléfono normalizado y preferencias limitadas | Memoria y persistencia verificadas en tests unitarios/PostgreSQL |
| 3 | Job, 18 estados, JobEvent, versión optimista, evidencia y desambiguación | Máquina de estados probada; todavía no conectada a WhatsApp |
| 4 | Task con tipos pedidos, deduplicación y vínculos tenant/chat/trabajo | Creación y deduplicación verificadas con eventos en PostgreSQL aislado |
| 5 | Approval con revisión OWNER, auditoría, estado y payload | Pago/fecha verifican aprobación del mismo trabajo y monto/fecha |
| 6 | ConversationSummary versionado con fuentes del chat | Las preferencias/resúmenes no actualizan hechos comerciales |
| 7 | ContextBuilder con 15–30 mensajes, resumen y hechos separados, usado por prepareTurn | Flujo básico probado en PostgreSQL; falta verificar exhaustivamente límites y recuperación contextual |
| 8–9 | Núcleo, herramientas ejecutadas desde plan persistido, recibos verificados antes de cierre; intérprete heurístico/contextual intercambiable | OpenAI solo mock; dispatcher del dueño pendiente. Se renueva reserva antes de herramientas, petición contextual limitada a 30 s |
| 10–11 | ProductConfiguration versionada con UNIT/AREA/LINEAR/FIXED/PACKAGE, unidades y componentes; RULE_NOT_CONFIGURED | Cinco modalidades probadas en PostgreSQL; ficha comercial y validador offline listos; reglas reales aún no cargadas |
| 12 | Procesador → herramientas → requisitos versionados → cálculo determinista → presupuesto pendiente → Approval/Task; revisión OWNER y guardas | Notificación al dueño, entrega multimedia por partes/estado tras envío y futura política automática pendientes; este bloque mantiene aprobación manual |
| 13–15 | Transiciones básicas preparadas | Falta registro de pagos/evidencias y flujo completo de producción/fechas basado en configuración |
| 16–19 | Pendiente completar PDF/inspección/audio/imágenes | Fixtures, persistencia y no repetir transcripción |
| 20–22 | Pendiente CatalogMedia, recomendaciones, seguimientos | Catálogo real, límites/horarios y exclusión de spam |
| 23–27 | Pendiente operadores, administración WhatsApp, settings, panel y autenticación | Web pública; cookie segura solo para administración, autorización también sobre APIs antiguas |
| 28–31 | Pendiente configuración/modelo/máquina de llamadas | OFF, máximo 5 min, aviso al fin de turno y continuidad por chat |
| 32–34 | Verificación progresiva | Tests completos, seguridad y volumen /data antes del cierre |
| 35–40 | Pendiente fase real, requiere autorización de saldo y credenciales vigentes | Texto/PDF/imagen/audio/llamada controlados; llamadas OFF al terminar |
| Aprendizaje | Pendiente después del núcleo | LearningSuggestion, feedback, outcomes, playbooks, aprobación, versiones y auditoría |

Las funciones internas que reciben TrustedActor NO son endpoints públicos. Los adaptadores
deben construir ese actor desde sesión/AuthorizedOperator verificado, nunca desde texto,
JSON del usuario, identidad propuesta por el modelo o un teléfono sin verificar.

## Invariantes comprobables

- Aceptar cotización no equivale a producir.
- Avisar un pago crea tarea y PAGO_POR_CONFIRMAR; imagen no aprueba depósito.
- Monto y fecha ejecutados deben coincidir con la aprobación.
- Adelantar fecha solo crea tarea. Vencimiento no entrega.
- Entrega y cambios requieren evidencia; un reclamo no borra entrega registrada.
- Repetición del mismo evento no duplica historial/tarea; contenido distinto se rechaza.
- Eventos concurrentes no sobrescriben versiones silenciosamente.
- Referencias entre nuevas entidades usan claves compuestas con tenant en PostgreSQL.
- Solicitar humano crea una tarea; selección ambigua de trabajo no elige automáticamente.
- Cambiar requisitos invalida la aprobación de arte y exige revisión.
- Inicio de producción queda bloqueado hasta cargar/validar ProductConfiguration.
- Las tarifas consultadas excluyen isDemo=true, inactivas, futuras, vencidas y otros tenants.
- Las unidades/servicios se mapean desde configuración aprobada: el modelo no introduce tarifas ni descuentos.
- Cotizar requiere vigencia del presupuesto configurada y nombre del cliente; no se inventan.
- Un presupuesto conserva requisitos, revisión, configuración, tarifa y parámetros del cálculo.
- Reintentar la misma solicitud devuelve el mismo resultado; otra solicitud con igual clave se rechaza.
- Cambiar requisitos invalida la cotización, aprobación pendiente, arte y fecha previos.
- Aprobar exige dueño, revisión vigente, tarifa sin cambios, documento no vencido y huella del cálculo intacta.
- El envío WhatsApp rechaza borradores, documentos vencidos, otro destinatario o requisitos obsoletos antes de generar audio.
- Aprobar un presupuesto no lo envía ni inicia producción automáticamente.

## Pruebas

En server: `npm run build` y `npm test`. Las pruebas unitarias no requieren credenciales ni red.
Las pruebas de integración solo admiten TEST_DATABASE_URL cuyo host sea localhost/127.0.0.1
y base joker_core_test; nunca caen por defecto en DATABASE_URL.
No llamar todas las fases completas por disponer de modelos: cada ruta, efecto y autorización
debe verificarse al conectarla. Este documento seguirá actualizándose con resultados reales.

Verificación local anterior al nuevo puente: **126 tests aprobados, ninguno omitido**, incluyendo 12 tests de
integración con PostgreSQL real aislado. `npm run build`, `prisma validate`, `prisma generate`
y `git diff --check` correctos. Las pruebas PostgreSQL ejecutadas verifican replay concurrente
de presupuestos/trabajos, snapshots JSONB, aislamiento, reserva de turnos entre réplicas,
rollback de efecto comercial junto a su recibo y confirmación tardía sin duplicar salidas.
No prueban todavía el flujo de red real completo ni todos los requisitos de las 40 fases.

La consulta `docker ps` de la sesión 91682 permanece pendiente; no se ha reiniciado ni borrado
Docker ni sus volúmenes. La validación de base de datos ya NO depende de ese proceso:
se utilizó PostgreSQL temporal nativo en 127.0.0.1:55439, base joker_core_test, sin producción.

## Continuación inmediata y límites de esta entrega

1. Completar el procesador compartido de turnos y las herramientas restantes. Debe obtener
   actor/contacto desde adaptadores verificados, validar los mensajes fuente, resolver el trabajo
   y ejecutar el flujo existente. El procesador WhatsApp antiguo aún no usa todo el Agent Core.
2. Completar fase 12: notificación/revisión por el dueño, envío persistente por partes con
   idempotencia y actualización de Job solo con envío confirmado. Las cotizaciones generadas
   por QuoteWorkflowService son siempre pendientes; habilitar automáticas solo al conectar
   TenantSettings y reglas explícitas del producto. No omitir esta rama en el cierre final.
3. Seguir con pagos, producción y fechas, luego archivos y las demás fases del alcance.
   El registro contable de pagos todavía no existe; los eventos básicos no lo sustituyen.
4. Cerrar los endpoints administrativos antiguos durante la fase de autenticación. El bloqueo
   de la aprobación legacy para presupuestos del nuevo workflow no equivale a autenticar
   todo el sistema. Los descuentos de la ruta pública están bloqueados; falta el flujo aprobado
   de descuentos/precios especiales del dueño.
5. Mantener las pruebas PostgreSQL aisladas antes de llevar cambios de schema a Railway.
   db push solo se ejecutó contra el cluster temporal nuevo. No se cargaron tarifas reales,
   no se modificó la base Railway ni se desplegaron estos cambios.

La numeración usa UUID para evitar colisiones por `count + 1`. Si se necesita numeración
correlativa corta, implementar un contador transaccional con convivencia de documentos
existentes; no volver a calcular el próximo número contando filas.

## Capa de herramientas del cliente y buffering (2026-09-08)

`CustomerToolsService.execute` se utiliza dentro de `SalesAgentService.executeCustomerTool`
con un TurnHandle reservado y recibos durables; no usar el dispatcher sin esa reserva en canales.
Valida los mensajes entrantes contra conversación/tenant y construye el actor CUSTOMER desde el
contacto de ese canal; ni el texto ni los argumentos del modelo pueden declarar OWNER/tenant.
Herramientas actuales: findContactProfile, findCustomer, findJobs, findQuote, findProduct,
getProductConfiguration, createJob, saveRequirements, calculateQuote, updatePreferences y
updateJobStatus limitado a eventos del cliente. Confirmar pagos, modificar precios o fijar
fechas no están entre las herramientas del cliente. Las herramientas privilegiadas deben
añadirse posteriormente al adaptador del operador autorizado, no a esta lista.

Cada selección/mutación de trabajo comprueba contacto y tenant. No se exponen importes
pendientes o vencidos al agente del cliente. La creación desde un mismo bloque de mensajes
tiene una clave de origen y slot lógico; reintentos con otros IDs de llamada no duplican
el trabajo. Bloqueo transaccional de conversación y unique(tenantId, originKey) respaldan
esa garantía; la prueba PostgreSQL concurrente ya fue ejecutada correctamente.

Cambios en el canal existente: el webhook ya no envía una bienvenida inmediata. El nuevo
puente genera la respuesta del plan tras la pausa y la encola; la política de bienvenida
y su marca greetedAt deben integrarse a la confirmación de esa salida. Mensajes
nuevos no borran HANDOFF/CLOSED. El worker excluye esos estados y comprueba la pausa también
cuando se invoca directamente; sus actualizaciones finales/de error no los reemplazan.
Solicitar humano/reclamar por un trabajo marca HANDOFF en la misma transacción del evento.

El recibo durable de turnos/herramientas y las reservas entre réplicas se describen abajo.
El intérprete heurístico y el transporte de texto ya tienen conexión local; faltan el
intérprete contextual completo, herramientas desde el plan, interrupción de respuestas
en curso y notificación al operador. No presentar esto como el flujo comercial completo.

## Turnos persistentes y cola de salida (2026-09-08)

- AgentTurn, AgentTurnMessage: un bloque de hasta 30 mensajes, reserva de 90 s, plan persistido,
  estado y hasta 3 recuperaciones antes de revisión. Restricciones relacionales impiden asignar
  un mensaje a dos turnos; claimNext serializa por conversación y no reclama durante la pausa.
- AgentToolCall: argumentos y resultado por callId; la operación comercial y el recibo se
  confirman en la MISMA transacción. transactionScope reutiliza los servicios existentes sin
  abrir transacciones independientes. Un crash antes del recibo revierte también el efecto.
- Un procesador con lease anterior/expirado no puede escribir; las recuperaciones usan el
  plan guardado y devuelven resultados ya registrados, sin repetir la acción.
- AgentOutbox: completar un turno marca sus mensajes procesados y encola el texto en una
  transacción. No significa que el cliente ya lo recibió. AgentOutboxService reserva el envío,
  exige confirmación positiva del proveedor y registra una única salida por ID externo.
- Un envío SENDING que pierde confirmación pasa a UNCERTAIN con tarea para revisión, nunca
  se reenvía automáticamente. Una confirmación tardía del mismo intento resuelve el estado.
  Esto evita reintentos ciegos; NO se afirma una garantía exactly-once sobre una API externa.

El nuevo puente de texto reclama turnos, interpreta fuera de transacción, persiste el plan
y finaliza en outbox. El despachador llama sendTextRaw y registra la confirmación mediante
AgentOutboxService; el envío multimedia legacy sigue fuera de esta cola.
Falta ejecutar herramientas con IDs estables desde ese plan, renovar lease en operaciones
largas, revisión/reanudación autorizada de turnos fallidos y reconciliación de envíos.
Los workers de entrada y salida tienen funciones distintas; no hay un segundo procesador
de los mismos mensajes entrantes. Los acuses HANDOFF ya encolados se recuperan tras reinicio.

## Ejecutar tests PostgreSQL sin Docker (Windows)

Se añadió `server/scripts/isolated-postgres-tests.mjs`. Instalar la herramienta temporal
[embedded-postgres](https://github.com/leinelissen/embedded-postgres) en un directorio nuevo
`joker-pg-test-*` dentro de TEMP y pasar su ruta al script. La versión usada fue
18.4.0-beta.17. No se añadió esa dependencia a producción.

El script verifica la ruta temporal, inicializa un cluster nuevo, escucha solo en loopback,
comprueba data_directory antes de crear joker_core_test, sobrescribe DATABASE_URL y
TEST_DATABASE_URL para los procesos de pruebas, vacía las credenciales API y detiene el
cluster al terminar. Conserva los archivos de prueba para inspección; no borra carpetas.
La autenticación trust del cluster local SOLO corresponde a fixtures efímeras, nunca a
producción. Las dos ejecuciones realizadas terminaron con el servidor de prueba apagado.

## Continuación: puente de texto y despacho (2026-09-08)

Se preservaron los cambios locales aportados por el usuario: intérprete inicial, puente del
procesador, sendTextRaw y processAgentOutbox. Sobre ellos se implementó:

- Registro de AgentOutboxService en providers: exportarlo sin registrarlo impedía resolver
  correctamente las dependencias de Nest.
- WhatsAppOutboxWorkerService registrado en WhatsAppModule. Consulta solo la primera salida
  no resuelta de cada conversación WhatsApp del tenant. Despacha aunque ya no queden mensajes
  entrantes buffered y también recupera acuses HANDOFF y envíos SENDING expirados.
- Orden por conversación y reservas de base de datos entre réplicas. Un envío UNCERTAIN o
  FAILED bloquea sus partes siguientes, pero no bloquea conversaciones ajenas.
- Un chat CLOSED cancela su salida pendiente. HANDOFF permite únicamente su acuse controlado.
  Un envío externo que ya empezó no puede retirarse con esta implementación.
- Timeout de 30 segundos para sendTextRaw. Un fallo sin confirmación sigue el mecanismo
  conservador UNCERTAIN: no reenvío automático ni afirmación de entrega al teléfono.
- Recuperación del plan guardado por WhatsAppProcessorService, sin reinterpretar ni
  reemplazar la decisión al reintentar. El dispatcher de herramientas aún no se ejecuta
  desde el puente: no afirmar que este flujo ya crea/cotiza trabajos completos.
- Tareas de revisión del plan guardadas junto al cierre del turno y su respuesta. Solo
  combinaciones explícitas de decisión/tipo; no se aprueban pagos, fechas ni presupuestos.
  Son tareas de conversación: falta vincular/ejecutar eventos del trabajo seleccionado y
  notificar al operador por WhatsApp o panel.
- Solicitud de humano: Task, estado HANDOFF y acuse se confirman juntos. No queda una
  promesa de derivación sin tarea ni se reactiva la venta al llegar otro mensaje.
- Corrección de unidades en el intérprete inicial: letras dentro de «luminoso» o una medida
  ajena a la pareja ancho/alto no cuentan como unidad. Esto todavía no extrae ni convierte
  requisitos comerciales: el intérprete sigue siendo una base heurística sin OpenAI.

### Siguiente bloque pendiente

Validación de esta continuación: **156 tests aprobados, ninguno omitido, en 15 archivos**;
140 unitarios/contratos y 16 de integración PostgreSQL. Incluyen recorrido de texto desde
el procesador hasta una confirmación de transporte simulado, derivación humana, aviso de
pago, réplicas concurrentes, cancelación de salidas y recuperación de intentos inciertos.
`npm run build` y `git diff --check` correctos. El cluster temporal terminó apagado.

Conectar herramientas del cliente al plan durable (crear/resolver trabajo, guardar requisitos,
calcular con reglas reales) y añadir intérprete contextual validado con fixtures. Después:
revisión/notificación del operador autenticado, entrega multimedia por partes, política de
cotización automática mediante TenantSettings, registro de pagos, producción y fechas.
Se mantienen pendientes las demás fases, panel privado, llamadas OFF y aprendizaje controlado.

No se cambiaron schema ni tarifas durante esta continuación. No se hizo commit, push,
deploy, compra de saldo ni llamadas a OpenAI/Meta. Las pruebas se ejecutan con DB temporal y
transporte simulado; no prueban entrega real al WhatsApp de Joker.

## Checkpoint comercial previo a activar OpenAI y desplegar

Esta sección corresponde al archivo de instrucciones «CONTINUACIÓN JOKERWEB — BLOQUE
PREVIO A ACTIVAR OPENAI Y HACER DEPLOY» recibido después de la entrega de 156 pruebas.

### Implementado en este bloque

1. `SalesAgentService.prepareTurn` compila pasos con callId estable. `executePlan` ejecuta
   CustomerToolsService mediante la reserva de AgentTurn, renueva lease antes de cada paso
   y usa recibos AgentToolCall. Las referencias `$jobId`/`$revision` se resuelven con resultados,
   no con suposiciones. Recuperar reproduce el mismo plan y reutiliza sus recibos.
2. `AgentTurnsService.complete` verifica que existan los recibos de todos los pasos y que
   sus argumentos coincidan con el plan. No puede afirmar éxito antes de ejecutar herramientas.
   Efecto comercial y recibo mantienen la transacción existente. No se agregaron herramientas
   privilegiadas al cliente.
3. Nuevos trabajos, selección segura, requisitos parciales y nueva revisión por Job. Varios
   trabajos sin selección generan aclaración. Cambios invalidan presupuesto/arte/fecha según
   el workflow existente. Medidas sin unidad se guardan pendientes con unidad null; nunca
   heredan una unidad anterior. Una aclaración posterior puede completarlas.
4. Configuración GENÉRICA_V1 (valor técnico `GENERIC_V1`) para UNIT, AREA, LINEAR, FIXED y
   PACKAGE: unidades explícitas/conversiones validadas, cantidad, límites, variante, extras por
   unidad/pedido, preparación, mínimo de importe e impuesto. Aritmética decimal. Las claves
   comerciales críticas no son requisitos del cliente. Se preserva STANDARD_AREA_V1 legacy.
5. Campo nullable **PriceRule.commercialRates Json?** agregado al schema local. Requiere
   migración revisada antes de desplegar. No se modificó la base productiva. Cada configuración
   genérica referencia una tarifa del mismo producto/tenant que debe estar activa, vigente y
   no ser demo. La configuración también admite activación/vigencia propia.
6. Cotizaciones conservan requisitos/revisión, configuración ID/versión, tarifa/fecha de
   actualización, parámetros, desglose decimal y vigencia. Siempre PENDING_APPROVAL; no envía
   el importe de un borrador al cliente ni inicia producción. Un presupuesto existente con
   requisitos iguales se consulta, no se recalcula duplicándolo.
7. `AgentInterpreter` con implementación heurística y adaptador OpenAI. Default heuristic.
   `AGENT_INTERPRETER=openai` seleccionará el adaptador únicamente en un bloque autorizado;
   requiere OPENAI_API_KEY y AGENT_OPENAI_MODEL explícitos. El cliente SDK se construye tarde,
   maxRetries=0, timeout=30 s y store=false. No devuelve herramientas ni texto comercial.
   La salida estructurada pasa por interpretationSchema, incluidas claves seguras y job del
   contacto. Salida inválida, rechazo, configuración incompleta o fallo deriva a atención
   humana sin operaciones comerciales privilegiadas. No se probó ninguna llamada real.
8. 32 conversaciones fixture separan interpretación esperada, herramientas y estado/respuesta
   segura. Nuevas pruebas del motor, privilegios, salidas OpenAI mock y flujo completo con
   PostgreSQL aislado. `scripts/test-safety.ts` bloquea fetch real y vacía credenciales en tests.
9. Ficha de carga en `docs/JOKER_PRODUCT_CONFIGURATION_TEMPLATE.md`, con contrato JSON,
   modalidades, decisiones que debe aportar el propietario y comando de validación offline.
   `validate-product-configuration.ts` no escribe, publica ni se conecta a servicios.

El uso de OpenAI Docs orientó la salida estructurada y la validación adicional del adaptador:
[Structured Outputs, documentación oficial](https://developers.openai.com/api/docs/guides/structured-outputs).
La corrección semántica del modelo aún debe evaluarse con las reglas reales; un JSON válido
por sí solo no demuestra que el modelo haya entendido bien al cliente.

### Archivos nuevos en este bloque

- `server/src/agent-core/commercial-pricing.ts`, `commercial-pricing.fixtures.ts`, `commercial-pricing.spec.ts`.
- `server/src/agent-core/durable-sales-plan.ts`, `durable-sales-plan.spec.ts`.
- `server/src/agent-core/openai-interpreter.transport.ts`, `openai-interpreter.spec.ts`.
- `server/src/agent-core/conversation.fixtures.ts`, `conversation-fixtures.spec.ts`.
- `server/src/agent-core/commercial-flow.integration.spec.ts`.
- `server/scripts/test-safety.ts`, `server/scripts/validate-product-configuration.ts`, `server/vitest.config.ts`.
- `docs/JOKER_PRODUCT_CONFIGURATION_TEMPLATE.md`.

### Archivos modificados en este bloque

- `server/prisma/schema.prisma`, `server/.env.example`.
- Agent Core: `agent-core.module.ts`, `agent-decision.ts`, `agent-interpreter.service.ts`,
  `agent-turns.service.ts`, `product-configuration.schema.ts`, `product-configuration.service.ts`,
  `quote-workflow.service.ts`, `sales-agent.service.ts`.
- WhatsApp: `whatsapp-processor.service.ts`, `whatsapp-buffering.spec.ts`, `whatsapp-agent-core.spec.ts`.
- Este documento. Prisma Client regenerado localmente; no se versionan secretos ni artefactos generados.

Los demás cambios locales anteriores del propietario/entregas anteriores se preservaron;
el listado de git incluye también esos cambios. No se hizo commit ni push.

### Evidencia exacta y alcance de prueba

- Build Nest: correcto.
- Prisma validate y generate: correctos.
- Suite completa aislada: **241 aprobadas, 0 fallidas, 0 omitidas, 20 archivos**.
- Desglose: **206 unitarias/contratos y 35 integración PostgreSQL**.
- `npm test` sin TEST_DATABASE_URL omite intencionadamente las dos suites de integración;
  no es el resultado completo. El script aislado las activa sin usar DATABASE_URL de producción.
- Pruebas reales de DB: cinco modalidades, snapshots, varias conversaciones/revisiones,
  recuperación tras herramientas 1/2/3, recepción de pagos pendientes, HANDOFF, rechazo de
  tarifas demo/inactivas/futuras/vencidas/ajenas/regla desconocida, y una única salida por flujo.
- Transporte de WhatsApp: simulate real del gateway, sin Meta. Intérprete OpenAI: SDK mock.
- PostgreSQL temporal apagado al finalizar; archivos conservados para inspección.

### Qué debe aportar ahora el propietario

Completar una ficha por producto, sin ejemplos genéricos tomados como verdad: modalidad,
unidades, campos/preguntas, cantidades/límites, tarifas antes de impuesto, variantes, extras,
diseño/instalación/viáticos, archivos, producción, entrega, vigencia y casos con total esperado.
No se agregó panel de carga ni endpoints administrativos sin autenticación. El próximo bloque
debe cargar y probar esas reglas primero en local usando el servicio de publicación autorizado.

### Activación posterior y límites que siguen vigentes

El código está preparado para ensayar reglas reales y después probar OpenAI; **no hace falta
cargar crédito todavía**. Orden: ficha → carga local/aprobación → pruebas de sus importes →
saldo autorizado → definir AGENT_OPENAI_MODEL y AGENT_INTERPRETER=openai → pruebas locales
controladas → respaldo/revisión de schema Railway → despliegue autorizado → WhatsApp real.

Antes de producción pública también deben cerrarse los endpoints administrativos legacy,
revisar credenciales vigentes/webhook, persistencia /data y migración de todos los modelos
pendientes. Las llamadas permanecen OFF. Panel, callbacks multimedia, notificación al dueño,
registro contable de pagos y aprendizaje siguen fuera de este bloque. No afirmar que Joker
ya está listo para operar públicamente ni que todas las 40 fases estén completas.

No se consumió OpenAI, no hubo Meta real, compra de saldo, Railway deploy, modificación de
PostgreSQL producción, seed demo, tarifas reales, llamadas, aprendizaje, aprobación de pagos,
descuentos o producción automática. autoQuoteEnabled sigue false por defecto; incluso si una
configuración futura indica true, este workflow conserva aprobación manual hasta una política
TenantSettings completamente probada.

### Comandos de verificación (PowerShell)

```powershell
Set-Location 'C:\Users\Fernando\Documents\JOKERWEB\server'
npm run build
npm test
npx prisma validate
npx prisma generate
node scripts/isolated-postgres-tests.mjs 'C:/Users/Fernando/AppData/Local/Temp/joker-pg-test-65cbdc99-9902-4c5e-9dc0-a5e4695483da'
git -c safe.directory=C:/Users/Fernando/Documents/JOKERWEB diff --check
git -c safe.directory=C:/Users/Fernando/Documents/JOKERWEB status --short
```

El directorio temporal de herramientas debe existir; no es un volumen productivo. Si se
elimina, instalar embedded-postgres en otro directorio nuevo joker-pg-test-* dentro de TEMP
y usar su ruta. El script crea un cluster nuevo en cada ejecución; no reutiliza bases existentes.
