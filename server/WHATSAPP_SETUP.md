# WhatsApp: conexión y prueba local

El canal usa el mismo backend de ventas que la web. El webhook guarda cada
mensaje y espera una ventana de silencio antes de analizar el bloque completo.
Por defecto son 10 segundos (`WHATSAPP_DEBOUNCE_MS=10000`). Un saludo breve se
envía una sola vez al abrir la conversación; no dispara la cotización.

## Prueba sin Meta

Con PostgreSQL, Ollama y la API iniciados, mantener `WHATSAPP_MODE=simulate` y
ejecutar en PowerShell:

```powershell
$body = @{
  from = "51999999999"
  name = "Cliente de prueba"
  messages = @(
    @{ type = "text"; text = "Hola" },
    @{ type = "text"; text = "Quisiera un letrero luminoso de 2 por 1 metros con instalación" }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/channels/whatsapp/simulate -ContentType "application/json" -Body $body
Start-Sleep -Seconds 12
Invoke-RestMethod -Uri http://localhost:3000/api/channels/whatsapp/conversations | ConvertTo-Json -Depth 12
```

En el historial debe aparecer un solo saludo y, después del silencio, una
respuesta que pide dirección/distrito, logo y la foto opcional del espacio. Si
el cliente responde que no puede enviar la foto, el flujo guarda esa decisión
y continúa con fondo neutro.

## Conexión con WhatsApp Cloud API

Completar estas variables solo en `server/.env`:

```dotenv
WHATSAPP_MODE=cloud
WHATSAPP_VERIFY_TOKEN=un_token_largo_elegido_por_nosotros
WHATSAPP_APP_SECRET=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_GRAPH_VERSION=
```

La versión de Graph API queda explícita y sin valor predeterminado para no
atar el proyecto a una versión vencida. Se debe copiar la versión vigente que
muestre Meta al crear la aplicación.

Meta requiere una URL HTTPS pública. Durante pruebas se puede exponer
temporalmente el puerto 3000 con un túnel y registrar como callback:

`https://DOMINIO-PUBLICO/api/channels/whatsapp/webhook`

El backend ya incluye:

- verificación GET mediante `hub.verify_token` y devolución de `hub.challenge`;
- validación HMAC del encabezado `X-Hub-Signature-256` en modo cloud;
- deduplicación por identificador de mensaje;
- recepción de texto, imagen, audio y documento;
- descarga autenticada de medios desde Graph API;
- transcripción del audio con OpenAI cuando exista la clave;
- agrupamiento por silencio, persistente en PostgreSQL;
- simulador y bandeja local para revisar mensajes salientes.
- carga y envío de imágenes, PDF y audio mediante Media ID de Meta.

## Reglas comerciales preparadas

- `CUSTOM_COMPLEX`: letreros, letras corpóreas y proyectos variables. Solicita
  ubicación cuando hay instalación y el mensaje final permite revisar
  alternativas según el presupuesto.
- `FIXED`: impresiones y productos de tarifa estable. No ofrece negociación;
  solicita un adelanto configurable, inicialmente 50 %, y coordina recojo o
  entrega sin inventar una tienda.
- La foto del espacio siempre es opcional. Con consentimiento se agenda una
  propuesta contextual; sin ella se agenda una propuesta con fondo neutro.
- La IA extrae requisitos, pero no fija precios. El cálculo continuará usando
  reglas deterministas después de cargar las tarifas reales.

Las acciones `CALCULATE_DETERMINISTIC_QUOTE`, `GENERATE_*_VISUAL`,
`GENERATE_QUOTE_PDF` y `GENERATE_CUSTOMER_AUDIO` se guardan en `context.pendingJobs`
de la conversación. Mañana, al cargar las fórmulas reales y la clave OpenAI,
se conectará el ejecutor de estas acciones sin cambiar el webhook.

Cuando una cotización y su propuesta ya estén aprobadas para envío, el paquete
completo se entrega con:

`POST /api/channels/whatsapp/conversations/{conversationId}/deliver-quote/{quoteId}`

El endpoint prepara primero el PDF y el audio; después envía texto, propuesta
visual si existe, PDF y MP3. En modo simulación no llama a Meta: registra los
cuatro elementos en el historial para poder inspeccionarlos.
