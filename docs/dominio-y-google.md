# Dominio y Google

La web incluye títulos y descripciones propios para las once páginas públicas, metadatos Open Graph y datos estructurados Organization con el teléfono y correo reales. No se publica una dirección física sin confirmar. La compilación genera HTML con los metadatos de cada página; React los actualiza también al navegar sin recargar. El contenido de la página sigue siendo renderizado por React.

El servidor estático Caddy sirve esos HTML en las rutas públicas, con o sin barra final. La API y las herramientas comerciales internas están bloqueadas con HTTP 404 en la landing, y las URLs desconocidas también devuelven 404. No forman parte del sitemap. `robots.txt` permite rastrear el sitio público y excluye la API y las herramientas internas; el control de acceso lo hace el servidor, no robots.txt.

## Cuando se compre el dominio

1. En Railway, agregar el dominio personalizado al servicio y crear en el proveedor DNS los registros que indique Railway. Esperar a que el dominio y HTTPS estén activos. Si se usarán `www` y el dominio sin `www`, elegir uno como principal y redirigir el otro de forma permanente.
2. Configurar `VITE_SITE_URL=https://dominio-elegido` en las variables del servicio. Es una variable de **compilación**: volver a desplegar para generar las URLs canónicas, los datos estructurados y `sitemap.xml`. El Dockerfile declara su argumento de compilación. Mientras no esté definido el dominio, no se inventan URLs canónicas ni un sitemap con enlaces de localhost.
3. Usar `Dockerfile` y `railway.toml` del repositorio: la landing no necesita PostgreSQL, Prisma ni una clave de OpenAI. Quitar cualquier Start Command anterior que ejecute `npm start` dentro de `server`; el contenedor inicia Caddy. El healthcheck ahora es `/healthz`. Verificar desde Internet el inicio, una página de servicios, `/robots.txt` y `/sitemap.xml`. Todos los enlaces del sitemap deben usar el dominio principal y HTTPS.
4. Crear una propiedad de tipo Dominio en [Google Search Console](https://search.google.com/search-console/). Verificarla con el registro TXT que Google entregue en el DNS del dominio.
5. En Search Console, enviar `https://dominio-elegido/sitemap.xml`. Usar Inspección de URLs para comprobar el inicio y las páginas de servicios y solicitar indexación.

Para completar estos pasos se necesitan el dominio definitivo y acceso al servicio Railway, al DNS y a Search Console. La configuración local y el código por sí solos no publican el sitio ni hacen que Google lo indexe. Google decide cuándo rastrear e indexar; no se promete una posición ni una fecha de aparición.

## Validación

La imagen estática se compiló y probó con Caddy, incluyendo rutas públicas y barras finales, aislamiento de la API, metadatos, caché y compresión. Chromium comprobó el inicio y las diez páginas públicas en escritorio y móvil. La prueba automatizada de SEO usa `https://example.com` solo en un directorio temporal; ese dominio no se guarda en el sitio.

La imagen pública ya no compila ni ejecuta Prisma ni el backend comercial. `Dockerfile.sales` conserva esa configuración para referencia y desarrollo; requiere autenticación y correcciones antes de publicarse. No se ha conectado un dominio ni revisado una cuenta Railway desde este entorno. Ver `docs/seguridad-y-costes.md`.
