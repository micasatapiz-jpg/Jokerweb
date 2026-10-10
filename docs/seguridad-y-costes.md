# Revisión de seguridad y coste de la landing

Fecha de revisión: 9 de octubre de 2026. Se revisaron el código, las dependencias,
la configuración de despliegue y el contenedor local. No hubo acceso a una cuenta
Railway, su facturación, sus servicios activos ni un dominio en producción.

**Ampliación del 10 de octubre:** [Trivy revisó el repositorio y la imagen](security/trivy-results.md).
El frontend sigue sin alertas de dependencias, pero el binario de Caddy y Alpine
presentan cuatro hallazgos altos, ocho medios, uno bajo y siete sin clasificación.
La alerta de Range merece corrección antes de publicar. Estos hallazgos completan
el análisis del contenedor que no se había hecho en la revisión original.

## Hallazgos y correcciones

| Riesgo | Evidencia anterior | Resultado |
| --- | --- | --- |
| Alto: lectura/modificación de información comercial sin autenticación | `server/src/customers/customers.controller.ts` lista clientes; `quotes.controller.ts` lista y aprueba cotizaciones; no tienen guards de autorización | El Dockerfile público sirve archivos con Caddy. `/api`, `/app` y `/propuesta-visual` devuelven 404. El backend no se instala ni ejecuta. |
| Alto: abuso de servicios de pago | Rutas sin autenticación para análisis, generación visual, transcripción y voz llaman servicios de IA | La landing no ejecuta esas rutas ni necesita claves de OpenAI, Cloudinary, WhatsApp Business o una base de datos. |
| Alto en herramientas de compilación: dependencia vulnerable | `source-map-js@1.2.1`, GHSA-68fv-2mgg-jv7q, propagado a cuatro entradas de `npm audit` | Lockfile actualizado a 1.2.2. Auditoría del frontend: cero vulnerabilidades reportadas, incluyendo desarrollo. |
| Defensa HTTP incompleta | El servidor anterior no configuraba CSP, protección contra incrustación ni una política de caché específica para paquetes | CSP, `nosniff`, `DENY`, política de permisos, HSTS y Referrer-Policy en Caddy. Solo GET/HEAD, sin listado de directorios ni rutas privadas. |
| Coste de ejecución innecesario | El contenedor anterior incluía Nest, Prisma, PostgreSQL y proveedores de IA para una landing | Imagen final Caddy sin Node/npm ni API. Una réplica; no requiere volumen persistente. |
| Transferencia alta en primera visita | Secuencia de 61,2 MB en escritorio y 51,2 MB en móvil | 40,6 MB y 34,6 MB. Mismos 864 fotogramas, resolución, orden y recortes; compresión WebP con pérdida, calidad 75. |

El backend heredado permanece en Git para desarrollo: su auditoría completa
reportó 29 entradas (16 altas y 13 moderadas); con `--omit=dev`, 19 (10 altas y
9 moderadas). Estas cantidades incluyen dependencias afectadas transitivamente,
no necesariamente 29 fallos distintos. No se corrigió ni se certificó ese backend:
**no usar `Dockerfile.sales` en Internet** hasta implementar autenticación,
autorización, límites de uso y actualizar/probar sus dependencias.

No se encontraron coincidencias con patrones comunes de claves privadas,
tokens GitHub/AWS/OpenAI en los archivos rastreados examinados. Esto no constituye
un escaneo exhaustivo del historial ni una garantía de ausencia de secretos.
Las variables `VITE_*` son públicas: nunca deben contener claves privadas.

La CSP permite estilos inline porque GSAP y los componentes los usan. No permite
`unsafe-eval` ni scripts inline ejecutables. Las fuentes de Google son la única
dependencia visual externa permitida. Los enlaces a WhatsApp siguen funcionando.

## Optimización realizada

- Paquetes con nombres derivados de su contenido y `Cache-Control: public,
  max-age=31536000, immutable`; también los JS/CSS/imágenes compilados por Vite.
- HTML y service worker con `no-cache`, para revalidar al actualizar el sitio.
- JS/CSS/HTML y archivos de texto precomprimidos con gzip durante la compilación;
  el servidor puede servirlos sin comprimir cada petición.
- Caché persistente de la secuencia y presentación de entrada solo en la primera
  visita, como antes. La segunda visita comprobada no descargó ningún paquete.
- Fondo de inicio: 2.748.815 → 362.474 bytes. Fondo de producción del catálogo:
  1.922.829 → 114.812 bytes, mediante WebP, sin cambios de contenido.
- Las herramientas de ventas/IA se excluyen del bundle público. Se conservan para
  desarrollo local con `VITE_ENABLE_SALES_APP=true`; el contenedor público fuerza
  `false` y no sirve sus rutas.
- Se excluyen del despliegue unos 355 MB de secuencias individuales que ya no usa
  el reproductor. Se conserva el último fotograma para movimiento reducido.
  Los originales permanecen intactos en Git.

La animación todavía exige una descarga considerable en la primera visita. La
caché beneficia visitas posteriores, pero no reduce los bytes del primer acceso
desde otro navegador/dispositivo ni de sesiones donde se haya eliminado.

## Estimación para 1.000 visitas al mes

Tarifas contrastadas con la [documentación oficial de Railway](https://docs.railway.com/pricing):
egress US$0,05/GB, memoria US$10/GB/mes y CPU US$20/vCPU/mes, prorrateados por
consumo. Hobby cuesta como mínimo US$5 e incluye US$5 de recursos; consumir US$3
supone pagar US$5, consumir US$8 supone pagar US$8. No se suman US$5 a los US$3.

La fuente oficial se consultó en el repositorio `railwayapp/docs`, commit
`8777358c4be7317a91223221c8c56ad0287d3e07`, archivos `content/docs/pricing.md`,
`pricing/plans.md` y `pricing/cost-control.md`.

Supuestos: 1.000 **primeras sesiones sin caché**, una landing, una réplica, sin
PostgreSQL/API/volúmenes adicionales ni consumo de Railway Agent. No se presupone
que un CDN comparta la caché entre distintos visitantes.

| Concepto | Estimación mensual |
| --- | --- |
| Solo inicio: 35,08 MB móvil / 41,15 MB escritorio medidos en Chromium | 35–41 GB; US$1,75–2,06 |
| Inicio más todas las imágenes públicas: presupuesto conservador | 42–49 GB; US$2,10–2,45 |
| Memoria: presupuestar 64–128 MiB de uso medio, aunque la prueba local fue ~18 MiB | Aproximadamente US$0,63–1,25 |
| CPU: margen estimado para este volumen de tráfico estático | US$0,10–0,50; no es una medición de Railway |
| Recursos de la landing, sin servicios adicionales | Aproximadamente US$3–4,20 |
| Factura prevista en Hobby si esos supuestos se cumplen | US$5, antes de impuestos/dominio |

El contenedor se probó con límite de 128 MiB y 0,25 CPU, sin reinicios ni OOM.
La lectura de ~18 MiB y la CPU instantánea no sustituyen métricas mensuales de
Railway. El renderizado y la decodificación de los fotogramas ocurren en el
navegador del visitante, no en la CPU del hosting.

Mil personas pueden generar más de mil sesiones. Con 5.000 sesiones frías que
consuman todo el contenido, solo la transferencia rondaría US$10,50–12,25.
Los bots y otros servicios activos también pueden consumir recursos.

## Configuración pendiente en Railway

1. Desplegar `main` con **Dockerfile** y el healthcheck `/healthz`. Quitar un Start
   Command anterior que intente iniciar el servidor Nest. Railway termina HTTPS;
   Caddy escucha HTTP en el `PORT` que proporciona Railway.
2. Mantener una réplica. El código no requiere base de datos ni volúmenes. Si hay
   otros servicios activos en el proyecto, revisar su consumo aparte; este cambio
   de código no los detiene ni elimina sus datos.
3. Revisar los límites por réplica en Settings → Deploy → Replica Limits. Si la
   interfaz lo permite, 128 MiB y 0,25 CPU fueron suficientes en estas pruebas;
   vigilar métricas reales antes de adoptar límites tan bajos en producción.
4. En Workspace Usage, crear una alerta de gasto cerca de US$4 y observar la
   proyección durante la primera semana. El [control oficial de costes](https://docs.railway.com/pricing/cost-control)
   indica que el **hard limit mínimo es US$10** y detiene los servicios al
   alcanzarlo. No hay un tope automático exacto de US$5 según esa documentación.
   El límite de Compute y el de Railway Agent son independientes.
5. Para garantizar un presupuesto de hosting estático sin cargos por CPU/egress
   de Railway, evaluar Cloudflare Pages y sus límites del plan gratuito. Cualquier
   cambio de proveedor o configuración de DNS requiere completar ese despliegue;
   no se realizó aquí. El dominio se paga aparte.

## Verificación reproducible

```sh
npm ci
npm audit
npm audit --omit=dev
npm run lint
npm run build
node --test src/config/seo.test.js src/services/sequenceFrameStore.test.js src/utils/framePacks.test.js src/utils/whatsappLink.test.js
docker build -t jokerweb-landing .
docker run --rm -p 3000:3000 --memory=128m --cpus=0.25 jokerweb-landing
# En otra terminal:
python scripts/check_static_security.py http://localhost:3000
```

El entorno de esta revisión usa un proxy HTTPS: la compilación local se completó
pasando su CA como secreto temporal BuildKit `build_ca`, sus argumentos de proxy
y una entrada DNS local. La CA no se copia a la imagen y no se desactiva la
verificación TLS. Railway normalmente no necesita esos parámetros.

Resultado: imagen compilada; lint y 12 pruebas unitarias aprobadas; prueba HTTP
de las once páginas, rutas privadas y archivos sensibles bloqueados, GET/HEAD,
gzip, caché, ETag/304 y rangos de paquetes. Chromium probó escritorio y móvil,
scroll offline en ambos sentidos, la segunda visita sin intro/descargas, las
diez páginas interiores sin imágenes rotas/errores JS/violaciones CSP y
movimiento reducido sin descarga de paquetes.

En la revisión original no se hizo un pentest del hosting en Internet ni un
escaneo de CVEs de la imagen de Caddy; el análisis posterior con Trivy está
enlazado al principio del documento. Mantener la imagen del servidor actualizada,
repetir auditorías y comprobar cabeceras/métricas después del despliegue.
