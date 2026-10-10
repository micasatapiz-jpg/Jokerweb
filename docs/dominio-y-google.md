# Dominio y Google

La web incluye títulos y descripciones propios para las once páginas públicas, metadatos Open Graph y datos estructurados Organization con el teléfono y correo reales. No se publica una dirección física sin confirmar. La compilación genera HTML con los metadatos de cada página; React los actualiza también al navegar sin recargar. El contenido de la página sigue siendo renderizado por React.

El servidor sirve esos HTML en las rutas públicas, con o sin barra final. Las rutas comerciales internas y las URLs desconocidas tienen `noindex`; no forman parte del sitemap. `robots.txt` permite rastrear el sitio público y excluye la API y las herramientas internas.

## Cuando se compre el dominio

1. En Railway, agregar el dominio personalizado al servicio y crear en el proveedor DNS los registros que indique Railway. Esperar a que el dominio y HTTPS estén activos. Si se usarán `www` y el dominio sin `www`, elegir uno como principal y redirigir el otro de forma permanente.
2. Configurar `VITE_SITE_URL=https://dominio-elegido` en las variables del servicio. Es una variable de **compilación**: volver a desplegar para generar las URLs canónicas, los datos estructurados y `sitemap.xml`. El Dockerfile declara su argumento de compilación. Mientras no esté definido el dominio, no se inventan URLs canónicas ni un sitemap con enlaces de localhost.
3. Verificar desde Internet el inicio, una página de servicios, `/robots.txt` y `/sitemap.xml`. Todos los enlaces del sitemap deben usar el dominio principal y HTTPS.
4. Crear una propiedad de tipo Dominio en [Google Search Console](https://search.google.com/search-console/). Verificarla con el registro TXT que Google entregue en el DNS del dominio.
5. En Search Console, enviar `https://dominio-elegido/sitemap.xml`. Usar Inspección de URLs para comprobar el inicio y las páginas de servicios y solicitar indexación.

Para completar estos pasos se necesitan el dominio definitivo y acceso al servicio Railway, al DNS y a Search Console. La configuración local y el código por sí solos no publican el sitio ni hacen que Google lo indexe. Google decide cuándo rastrear e indexar; no se promete una posición ni una fecha de aparición.

## Validación de esta revisión

- Compilación del frontend y lint correctos; nueve pruebas de secuencias, caché y SEO.
- Prueba del servidor estático Fastify: metadatos específicos para rutas públicas, barras finales y parámetros de consulta.
- Chromium: diez páginas públicas, mensajes WhatsApp breves con emojis y el número original, todos los detalles de producto y cambio de título al navegar.
- La prueba de SEO usa `https://example.com` solo en un directorio temporal para comprobar la generación de canónicas y sitemap; ese dominio no se guarda en la configuración del sitio.

Limitación del entorno de validación: Prisma devolvió HTTP 403 al descargar el checksum de su motor desde `binaries.prisma.sh`, por lo que no se completó la generación del cliente ni la comprobación del backend completo. Las pruebas directas de Fastify y la compilación del frontend sí pasaron. Antes de publicar en Railway, comprobar la compilación del contenedor y las variables que ya requiere el backend; no se ha desplegado ni conectado un dominio desde esta revisión.
