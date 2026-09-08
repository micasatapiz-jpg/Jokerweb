# Joker IA — avance y criterios de cierre

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
| 7 | ContextBuilder con 15–30 mensajes, resumen y hechos separados | Falta integrar al agente y probar límites con PostgreSQL |
| 8–9 | Prompt, decisiones por intención, SalesAgentService, CommercialService, QuoteWorkflowService y dispatcher CustomerToolsService | Herramientas del cliente disponibles mediante el núcleo; falta intérprete, dispatcher del dueño y ejecución persistente de turnos/conexión completa a canales |
| 10–11 | ProductConfiguration versionado e inmutable, validadores, RULE_NOT_CONFIGURED y CHECK_PRODUCT_RULE | Snapshots/permisos/versiones verificados en PostgreSQL; reglas reales aún no cargadas |
| 12 | Requisitos versionados → cálculo determinista → presupuesto pendiente → Approval/Task → revisión OWNER; guardas en entrega WhatsApp | Falta conectar al procesador de turnos, notificar al dueño, estado tras envío y entrega idempotente; cotización automática depende de TenantSettings pendiente |
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

Última verificación local: **126 tests aprobados, ninguno omitido**, incluyendo 12 tests de
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

Cambios en el canal existente: el webhook ya no envía una bienvenida inmediata; la envía
el worker tras el intervalo de pausa, y registra greetedAt después del envío. Mensajes
nuevos no borran HANDOFF/CLOSED. El worker excluye esos estados y comprueba la pausa también
cuando se invoca directamente; sus actualizaciones finales/de error no los reemplazan.
Solicitar humano/reclamar por un trabajo marca HANDOFF en la misma transacción del evento.

El recibo durable de turnos/herramientas y las reservas entre réplicas se describen abajo.
Todavía pendiente: conexión al intérprete y transporte WhatsApp, interrupción de respuestas
ya en curso y notificación persistente al operador. No presentar el nuevo núcleo como
conectado de extremo a extremo hasta implementar y probar esos puntos.

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

El transporte Meta todavía no usa esa cola y el procesador antiguo no reclama estos turnos.
Falta el adaptador completo: interpretar fuera de la transacción, persistir el plan inicial,
renovar lease, ejecutar pasos con IDs estables, finalizar y despachar la cola. No deben existir
dos workers procesando los mismos mensajes. Preparar también recuperación de acuses HANDOFF
tras reinicio, revisión/reanudación autorizada de turnos fallidos y reconciliación de envíos.

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
