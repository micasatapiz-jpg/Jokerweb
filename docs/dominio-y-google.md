# Dominio y Google

El dominio principal configurado en el código es **https://jokeperu3d.com**, indicado por el usuario. `VITE_SITE_URL` permite cambiarlo si fuera necesario. Este dato configura el sitio y su sitemap; por sí solo no conecta los DNS ni crea el dominio en Railway.

La web incluye títulos y descripciones orientados a Lima para las páginas comerciales, metadatos Open Graph y datos estructurados Organization con el teléfono y correo reales y `areaServed` Lima/Huancayo. No se publica una dirección física sin confirmar. La compilación prerenderiza las once páginas públicas con su contenido real, encabezados, productos y enlaces, además de los metadatos. React hidrata ese HTML para conservar la animación y las interacciones, y actualiza el SEO al navegar.

El servidor estático Caddy sirve esos HTML en las rutas públicas, con o sin barra final. La API y las herramientas comerciales internas están bloqueadas con HTTP 404 en la landing, y las URLs desconocidas también devuelven 404. No forman parte del sitemap. `robots.txt` permite rastrear el sitio público y excluye la API y las herramientas internas; el control de acceso lo hace el servidor, no robots.txt.

## Cuando se compre el dominio

1. En Railway, agregar el dominio personalizado al servicio y crear en el proveedor DNS los registros que indique Railway. Esperar a que el dominio y HTTPS estén activos. Si se usarán `www` y el dominio sin `www`, elegir uno como principal y redirigir el otro de forma permanente.
2. Usar `VITE_SITE_URL=https://jokeperu3d.com` en Railway, o dejar la variable vacía para usar ese dominio predeterminado del código. Es una variable de **compilación**: volver a desplegar al cambiarla. Se generan canónicas y sitemap del dominio principal. Agregar también `www.jokeperu3d.com` como dominio personalizado si se usará ese alias: Caddy lo redirige con 308 al principal, conservando ruta y parámetros. Ambos necesitan DNS y certificado válidos en Railway.
3. Usar `Dockerfile` y `railway.toml` del repositorio: la landing no necesita PostgreSQL, Prisma ni una clave de OpenAI. Quitar cualquier Start Command anterior que ejecute `npm start` dentro de `server`; el contenedor inicia Caddy. El healthcheck ahora es `/healthz`. Verificar desde Internet el inicio, una página de servicios, `/robots.txt` y `/sitemap.xml`. Todos los enlaces del sitemap deben usar el dominio principal y HTTPS.
4. Crear una propiedad de tipo Dominio en [Google Search Console](https://search.google.com/search-console/). Verificarla con el registro TXT que Google entregue en el DNS del dominio.
5. En Search Console, enviar `https://jokeperu3d.com/sitemap.xml`. Usar Inspección de URLs para comprobar el inicio y las páginas de servicios y solicitar indexación. Para una propiedad de prefijo URL, el método HTML también está preparado: `VITE_GOOGLE_SITE_VERIFICATION` admite el token público de la etiqueta que entregue Google y requiere recompilar. La propiedad de tipo Dominio necesita verificación DNS TXT.

Para completar estos pasos se necesitan el dominio definitivo y acceso al servicio Railway, al DNS y a Search Console. La configuración local y el código por sí solos no publican el sitio ni hacen que Google lo indexe. Google decide cuándo rastrear e indexar; no se promete una posición ni una fecha de aparición.

## Validación

La imagen estática se compiló y probó con Caddy, incluyendo rutas públicas y barras finales, aislamiento de la API, metadatos, caché y compresión. Chromium comprobó el inicio y las diez páginas públicas en escritorio y móvil. La prueba automatizada de SEO usa `https://example.com` solo en un directorio temporal; ese dominio no se guarda en el sitio.

La imagen pública ya no compila ni ejecuta Prisma ni el backend comercial. `Dockerfile.sales` conserva esa configuración para referencia y desarrollo; requiere autenticación y correcciones antes de publicarse. No se ha conectado un dominio ni revisado una cuenta Railway desde este entorno. Ver `docs/seguridad-y-costes.md`.

## Priorización de Lima

Los títulos, descripciones y textos visibles relacionan los servicios con Lima. Esto ayuda a comunicar la cobertura real; Google decide las posiciones en función de muchos factores. No existe una configuración que garantice aparecer primero para todas las personas de Lima.

Si el negocio cumple las condiciones de Google para atención presencial o servicios en el lugar del cliente, puede completar un Perfil de Empresa como negocio de área de servicio. No crear una oficina ficticia en Lima ni publicar una dirección sin confirmar. Las reseñas deben proceder de clientes reales. Las herramientas de Search Console y ese perfil necesitan acceso a la cuenta de Google correspondiente y su verificación; no se activan mediante la publicación del código.

## Estado de esta preparación

- Contenedor compilado, prerenderizado de once páginas y sitemap del dominio indicado comprobados localmente.
- Chromium en escritorio y móvil: hidratación sin errores, imágenes y CSP correctas, scroll offline, caché y movimiento reducido.
- HTTP local: redirección de `www`, caché, rangos simples 206 y rechazo de multirrango 400. El rechazo mitiga CVE-2026-78667 antes de llegar a Go ServeContent. El binario sigue necesitando actualización de dependencias; no se declara que sus CVE estén corregidas.
- El contenedor recibe HTTP/1; Railway termina HTTPS. La mitigación no modifica las secuencias ni su caché.
- Falta acceso autenticado a la cuenta/proyecto de Railway y al DNS para comprobar o modificar el dominio y completar la publicación. El complemento Railway no estaba disponible entre las herramientas de esta sesión. Se guardó un requisito seguro `RAILWAY_API_TOKEN`, con destino `backboard.railway.com`, en la configuración del entorno; todavía no se proporcionó el valor.
- Faltan la propiedad verificada de Search Console y el envío del sitemap en la cuenta de Google del propietario. No se afirma que el sitio esté publicado o indexado.
