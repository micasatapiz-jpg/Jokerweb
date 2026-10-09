# Fluidez de la animación unificada

Esta solución parte de `inicio-scroll-unificado`, commit
`54387c7b571703000b74fd7d3051d09601e6f79a`, no de `main`.
Conserva las siete secciones, el fondo ilustrado, las transiciones JOKER,
la altura de scroll y **todos** los fotogramas actuales: 480 + 192 + 192 = 864.
Los WebP originales de los tres clips permanecen intactos.

## Diagnóstico de esta versión

El reproductor liberaba la entrada tras un máximo de 2,7 segundos aunque
todavía faltaran imágenes del búfer crítico. A la vez, el almacenamiento
en segundo plano y el reproductor podían pedir las mismas imágenes por
separado. El caché persistente conserva archivos comprimidos, pero no
los mantiene decodificados para dibujar. Si faltaba el destino, se
mostraba la imagen más cercana disponible, dando saltos entre posiciones.

La secuencia actual suma 356.075.614 bytes. Esta cifra y los fotogramas
corresponden a la animación nueva, no a los PNG de la versión de `main`.

## Cambio

- Cada fotograma actual se conserva, en el mismo orden y con el mismo
  recorrido. No hay muestreo ni sustitución de ilustraciones.
- Se generan variantes WebP con calidad 85: escritorio a 960 × 540 y móvil
  vertical con recorte a 540 × 720. El móvil conserva la altura original y
  el encuadre horizontal del 58%. Esta compresión es con pérdida.
- Los fotogramas se agrupan de 64 en 64 en 14 archivos binarios por variante.
  El encabezado `JSEQ001` contiene el número de imágenes y sus longitudes.
  El lector verifica límites, cantidades y tamaño completo antes de usarlos.
- Escritorio descarga 61.217.674 bytes; móvil, 37.683.064 bytes: cerca de un
  83% y un 89% menos, respectivamente, con todos los fotogramas originales.
- Se permiten cuatro descargas simultáneas. La entrada espera la descarga
  completa y la preparación del destino actual, incluso si se hizo scroll
  durante el indicador. No hay un plazo que marque imágenes pendientes
  como listas. La primera entrada sigue necesitando una carga real.
- Los paquetes tienen nombres derivados de su SHA-256 y se guardan en
  `joker-sequence-packs-v1`. Las visitas siguientes reutilizan esos bytes.
  El service worker existente conserva su función para imágenes individuales
  y deja los paquetes a su propio gestor, evitando otra ruta de caché.
- Solo se conservan 32 imágenes decodificadas, con tres decodificaciones
  simultáneas. Se prioriza el destino actual, se descartan posiciones viejas
  de la cola y se liberan los bitmaps expulsados. El dibujo se agrupa por
  `requestAnimationFrame`; no se repite si el fotograma no cambia.
- Los fallos muestran una opción de reintento. Movimiento reducido descarga
  solamente el último WebP original, sin preparar toda la animación.

Con una conexión lenta, descargar la variante completa puede tardar decenas
de segundos. El cambio prioriza un recorrido preparado de principio a fin;
no promete una entrada instantánea ni 60 FPS en todos los dispositivos.
Los archivos originales siguen en `public`, por lo que también se copian a
`dist`: esta mejora reduce la transferencia durante la visita, no el tamaño
total del artefacto de despliegue.

## Regeneración y comprobaciones

```sh
python3 scripts/pack_scroll_frames.py
node --test src/services/sequenceFrameStore.test.js src/utils/framePacks.test.js
node scripts/test-sequence-cache.mjs
npm run lint
npm run build
```

El generador necesita Pillow. El manifiesto
`src/config/sequenceBundles.json` identifica el commit de origen, las
posiciones globales y el SHA-256 de las imágenes fuente de cada grupo.
Permite verificar que los paquetes vienen de los WebP actuales.

Las pruebas cubren concurrencia limitada, cambios bruscos de destino,
liberación de memoria, fallos de carga, integridad y orden de los 864
fotogramas, caché persistente y recuperación de una entrada corrupta.
La validación funcional usa Chromium con caché HTTP desactivada y CPU
ralentizada 4×; comprueba escritorio, móvil, scroll durante la preparación,
avance y retroceso sin red después de cargar, segunda visita sin descargar
paquetes, movimiento reducido y error de descarga. Las pruebas de
interceptación bloquean service workers para observar las solicitudes;
el flujo normal con el service worker también se comprueba aparte.
