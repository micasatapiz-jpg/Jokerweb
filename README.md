# Joker Publicidad + sistema local de cotizaciones

Sitio comercial en React/Vite y primer MVP local para clientes, precios y
cotizaciones asistidas por Ollama.

## Desarrollo local

### Requisitos

- Node.js 22
- Docker Desktop iniciado
- Ollama con el modelo `qwen3.5:4b`

### Primera ejecución del sistema de cotizaciones

Abre tres ventanas de PowerShell en esta carpeta.

1. Base de datos:

   ```powershell
   npm run local:db
   npm --prefix server run prisma:push
   npm --prefix server run prisma:seed
   ```

2. API:

   ```powershell
   npm run local:api
   ```

3. Página web:

   ```powershell
   npm run local:web
   ```

Abre `http://localhost:5173/cotizar` para crear una cotización y
`http://localhost:5173/app` para revisarla. La API responde en
`http://localhost:3000/api/health`.

`/cotizar` es el recorrido público para clientes: pedido, diseño e imágenes,
instalación, contacto y confirmación por WhatsApp. No muestra descuentos,
márgenes ni reglas internas. `/app` y `/app/precios` siguen siendo superficies
administrativas separadas y deberán protegerse con autenticación antes de la
publicación.

Los logos, referencias y fotos del lugar se guardan temporalmente en
`server/uploads/quote-attachments`; PostgreSQL conserva su relación con la
cotización, tipo y consentimiento. En producción, esa capa se cambiará por
almacenamiento en la nube sin modificar el formulario.

### Propuestas visuales con OpenAI

La ruta `http://localhost:5173/propuesta-visual` analiza el logo y genera una
vista conceptual. Agrega tu clave únicamente en `server/.env`:

```dotenv
OPENAI_API_KEY=tu_clave_aqui
OPENAI_VISION_MODEL=gpt-5.4-mini
```

Después reinicia la API. El cliente puede elegir un fondo neutro sin subir
ninguna foto del local. La foto del espacio solo se habilita con aceptación
explícita y nunca se envía desde el navegador en el modo neutro.

### Notas de voz y audio final de la cotización

El formulario de cotización permite subir notas de voz en MP3, M4A, WAV,
WebM, OGG, Opus o MP4. OpenAI transcribe el contenido y lo coloca en el campo
de solicitud para que una persona lo revise antes de enviarlo a Ollama.

El detalle de cada cotización prepara un texto comercial usando el total real
guardado en PostgreSQL. Desde ahí se puede copiar el texto o convertirlo en un
MP3. La IA no redacta ni calcula el precio; la voz únicamente lee el mensaje
determinista que muestra previamente el panel.

Variables disponibles en `server/.env`:

```dotenv
OPENAI_API_KEY=
OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe
OPENAI_SPEECH_MODEL=gpt-4o-mini-tts
OPENAI_SPEECH_VOICE=marin
BUSINESS_DISPLAY_NAME=Joker Publicidad
QUOTE_VISIT_ENABLED=false
QUOTE_VISIT_LABEL=Casa Tapiz
QUOTE_VISIT_ADDRESS=
QUOTE_VISIT_REQUIRES_APPOINTMENT=true
```

Para ofrecer Casa Tapiz como punto de atención, cambia
`QUOTE_VISIT_ENABLED=true` y agrega la dirección confirmada. Mientras esté en
`false`, el mensaje solo ofrece coordinar una llamada o reunión. Joker no se
presenta como una tienda física y la atención en Casa Tapiz se comunica con
cita previa.

Después de configurar la clave, reinicia la API y comprueba
`GET /api/communications/status`. Nunca guardes la clave en Git ni la coloques
en variables `VITE_*`, porque esas variables se publican en el navegador.

Configura las tarifas reales desde `http://localhost:5173/app/precios`.
Cada guardado crea una nueva versión y conserva la tarifa anterior para que
las cotizaciones ya emitidas no cambien.

Los precios cargados por `prisma:seed` son demostrativos. Deben reemplazarse
por costos y márgenes reales antes de entregar documentos a clientes.

## Scripts

- `npm run dev`: servidor de desarrollo.
- `npm run build`: compilación de producción.
- `npm run lint`: análisis estático.
- `npm run preview`: vista previa de la compilación.
- `npm run local:db`: inicia PostgreSQL en Docker.
- `npm run local:api`: inicia la API NestJS.
- `npm run local:web`: inicia la web para pruebas.

## Arquitectura local

- React/Vite: web comercial y panel.
- NestJS + Fastify: API de ventas.
- PostgreSQL + Prisma: clientes, productos, reglas y cotizaciones.
- Ollama `qwen3.5:4b`: extracción de requisitos desde texto libre.
- OpenAI Responses API: análisis del logo y generación de la propuesta visual.
- OpenAI Audio API: transcripción de notas de voz y generación del resumen hablado.
- PDFKit: cotización descargable.

El cálculo monetario es determinista: la IA no decide precios. Ollama solo
organiza la solicitud y el usuario confirma los datos antes de guardar.

El número de WhatsApp provisional se encuentra en
`src/components/WhatsAppButton.jsx`.

## Canal de WhatsApp preparado

El backend incluye un adaptador desacoplado para WhatsApp Cloud API y un modo
de simulación local. Agrupa mensajes consecutivos, evita responder solo al
primer "hola", registra imágenes y audios y conserva el estado comercial en
PostgreSQL. La guía de conexión y la prueba de mañana están en
`server/WHATSAPP_SETUP.md`.
