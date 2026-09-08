# Joker: despliegue en Railway

Estado: preparación local, todavía no desplegado. Sin dominio comprado ni compras realizadas.
Railway tiene sesión iniciada con prueba limitada de US$5/30 días, pero no encuentra repositorios.
Pendiente autorizar la integración GitHub para micasatapiz-jpg/Jokerweb y subir la rama
inicio-scroll-unificado actualizada (el backend y numerosos cambios web todavía eran locales).

## Arquitectura

Un servicio Docker sirve React y NestJS bajo el mismo subdominio HTTPS de Railway.
La API usa /api. PostgreSQL es otro servicio del mismo proyecto, conectado por red privada.
OpenAI ejecuta el análisis de requisitos, visión, imágenes y audio. AI_PROVIDER=openai elimina
la dependencia de Ollama en producción. Ollama sigue disponible en desarrollo.

## Crear el piloto

1. Iniciar sesión en Railway y crear un proyecto con un servicio PostgreSQL y un servicio
   para este repositorio, usando la raíz del proyecto y el Dockerfile incluido.
2. Antes de activar un plan de pago, confirmar el importe y presupuesto con el propietario.
3. En el servicio de aplicación, montar un volumen persistente en /data. No usar almacenamiento
   efímero para archivos. El Dockerfile configura /data/visual-proposals y /data/quote-attachments.
   Mantener una sola réplica: el procesador de mensajes todavía no tiene bloqueo distribuido.
4. Configurar las variables de la tabla. Nunca subir .env ni copiar secretos al frontend.
5. Inicializar la base VACÍA con `npx prisma db push` desde el contenedor del servicio.
   No usar --accept-data-loss. No ejecutar el seed de demostración sobre datos comerciales.
   Para conservar los datos locales, realizar un respaldo pg_dump y restaurarlo de forma
   controlada en la nueva base. Esta transferencia todavía está pendiente.
6. Generar el dominio del servicio en Networking. Probar /api/health y luego la web.
7. Actualizar el callback en Meta a https://DOMINIO/api/channels/whatsapp/webhook,
   verificar con WHATSAPP_VERIFY_TOKEN y comprobar la suscripción a messages.
8. Probar desde un destinatario autorizado de Meta. El número de prueba emisor no es el
   número comercial de Joker: registrar/migrar Joker es otro paso que no debe borrar su cuenta actual.

## Variables del servicio (valores secretos solo en Railway)

| Variable | Valor o propósito |
| --- | --- |
| DATABASE_URL | Referencia a la URL privada de PostgreSQL de Railway |
| DEFAULT_TENANT_ID | Mismo tenant de Joker que se migre desde la base local |
| AI_PROVIDER | openai (ya predeterminado en Docker) |
| OPENAI_API_KEY | Clave autorizada para Joker; comprobar saldo y acceso a modelos |
| OPENAI_TEXT_MODEL | gpt-5.4-mini |
| OPENAI_VISION_MODEL | gpt-5.4-mini |
| OPENAI_TRANSCRIPTION_MODEL | Mantener el modelo configurado y validar disponibilidad |
| OPENAI_SPEECH_MODEL | gpt-4o-mini-tts |
| OPENAI_SPEECH_VOICE | marin |
| PILOT_USER | Usuario exclusivo del piloto |
| PILOT_PASSWORD | Secreto aleatorio, mínimo 20 caracteres |
| WHATSAPP_MODE | cloud para integración real; simulate para pruebas sin envío |
| WHATSAPP_ACCESS_TOKEN | Token de Meta vigente |
| WHATSAPP_PHONE_NUMBER_ID | ID del emisor correcto; no el teléfono destinatario |
| WHATSAPP_APP_SECRET | Secreto de la app Meta |
| WHATSAPP_VERIFY_TOKEN | Secreto de verificación del callback |
| WHATSAPP_GRAPH_VERSION | Versión habilitada en Meta, por ejemplo v26.0 si corresponde |
| WHATSAPP_DEBOUNCE_MS | 10000 |
| WHATSAPP_POLL_MS | 3000 |
| BUSINESS_DISPLAY_NAME | Joker Publicidad |
| QUOTE_VISIT_* / QUOTE_PICKUP_* | Dirección real y condiciones confirmadas por Joker |
| QUOTE_DEPOSIT_PERCENT | 50, sujeto a confirmación comercial |

PORT lo asigna Railway. WEB_DIST_DIR y rutas persistentes ya están en Docker.
No definir VITE_* con secretos. La compilación del contenedor usa /api.

## Protección temporal

La versión de producción exige contraseña HTTP Basic para toda la web y API,
excepto health y el webhook firmado de Meta. Es un piloto privado, NO un portal
abierto a clientes. No compartir la contraseña del piloto con clientes: también
da acceso al panel de administración. Antes de abrir la web al público se necesita
autenticación por usuario, permisos administrativos, acceso limitado a cada cotización
y límites de consumo para endpoints de IA. No quitar la protección para simular que esto está listo.

## Pendientes funcionales reales

- Cargar y validar tarifas reales por producto, instalación, movilidad, viáticos e impuestos.
- Conectar el ejecutor automático de trabajos de WhatsApp: hoy reúne mensajes, transcribe
  audio y extrae requisitos, pero pendingJobs solo registra trabajos pendientes. No ejecuta
  automáticamente toda la cadena imagen + presupuesto + PDF + audio.
- Validar rechazo persistente de foto opcional, identificación de imágenes y datos faltantes.
- Mejorar reintentos/idempotencia del envío y bloqueo del procesador antes de usar varias réplicas.
- Autenticación y autorizaciones definitivas antes de publicar la web comercial.
- Política de privacidad y contacto responsable confirmados antes de publicar la app Meta.
- Verificar crédito y acceso de OpenAI con pruebas reales de texto, imagen, transcripción y voz.
- Reemplazar token temporal Meta por credencial operativa adecuada; conectar emisor Joker.
- Migrar base y archivos locales, programar respaldos y probar restauración.
- Revisar vulnerabilidades de dependencias detectadas por npm antes de lanzamiento público.
- Cloudinary sigue opcional: el volumen persistente resuelve el piloto de una réplica.

## Verificación y costo

`npm run build` en raíz; en server: `npm run build`, `npm test` y
`node scripts/smoke-production.mjs` (requiere PostgreSQL local, no llama APIs pagadas).
La prueba de humo usa una contraseña efímera que no se muestra ni guarda.
Comprobado: compilación frontend/backend, 15 pruebas unitarias y 8 verificaciones HTTP del
piloto privado. Estas pruebas no validan crédito OpenAI, envío real Meta ni publicación externa.
El Dockerfile debe validarse mediante docker build antes del despliegue.

Presupuesto orientativo Railway: US$6–12/mes, NO precio fijo; depende del consumo.
US$5 es el mínimo de Hobby e incluye US$5 de recursos. OpenAI/Meta van aparte.
Configurar alertas y revisar proyección tras 48–72 horas; un límite duro puede detener el servicio.

Fuentes: https://railway.com/pricing y https://developers.openai.com/api/docs/guides/structured-outputs
