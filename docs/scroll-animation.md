# Animación de scroll: diagnóstico y solución

## Qué producía los tirones

La landing utilizaba 1.440 PNG de 1280 × 720, con 560.403.339 bytes en total.
El indicador inicial esperaba solo 16 imágenes del primer clip y el inicio de
los otros dos: 18 imágenes, no la secuencia completa. Además, contaba los fallos
como imágenes preparadas.

Durante el scroll, cada actualización solicitaba hasta 48 vecinos sin limitar
las descargas simultáneas. El caché de 72 imágenes eliminaba las anteriores y
vaciaba su `src`. El caché HTTP puede conservar bytes comprimidos, pero no
garantiza que esas imágenes sigan decodificadas y listas para `drawImage`.
Cuando faltaba la imagen solicitada se dibujaba una cercana, incluso de otro
clip, dando la impresión de saltos. También se redibujaba el mismo fotograma
repetidamente durante el suavizado de GSAP.

## Implementación

- Los tres clips conservan su recorrido de scroll, su primer y último
  fotograma, y las transiciones existentes. Se muestrean 160 imágenes por clip
  en lugar de 480; no se sustituyen las escenas ni se modifican los originales.
- WebP de calidad 82: escritorio a 960 × 540 y móvil vertical a 540 × 720.
  El móvil conserva la altura original y recorta horizontalmente al 58%, igual
  que el canvas, para evitar ampliar una imagen panorámica de baja resolución.
  Se usa esta variante hasta 900px y con relación ancho/alto ≤ 3/4; al rotar o
  cambiar de variante se prepara la secuencia correspondiente.
- La variante de escritorio pesa 25.622.804 bytes; la móvil, 24.959.764 bytes:
  aproximadamente un 95% menos de descarga frente a los PNG originales.
- Se descargan todos los archivos de la variante elegida con cuatro solicitudes
  simultáneas antes de quitar el indicador. Los bytes comprimidos permanecen
  en memoria durante la visita; el scroll no necesita la red.
- Solo se conservan 32 imágenes decodificadas, con tres decodificaciones
  simultáneas. Se prioriza el destino actual y se descarta el trabajo pendiente
  de posiciones que el visitante ya abandonó. Los bitmaps expulsados se cierran.
- Se prepara una ventana de vecinos y se dibuja como máximo una vez por
  `requestAnimationFrame`, solo cuando cambia la imagen. Si falta el destino,
  se mantiene el dibujo anterior mientras se decodifica; no se sustituye por
  una imagen arbitraria de otra escena.
- Los fallos muestran un mensaje y permiten reintentar. Al desmontar la landing
  se cancelan las descargas y se liberan los bitmaps. Con movimiento reducido
  se descarga únicamente el último fotograma estático.

La carga inicial no es instantánea: la prueba con caché desactivada, 50ms de
latencia y 2 MB/s tardó aproximadamente 20 segundos en preparar escritorio.
Se espera la carga real para evitar descargar durante la reproducción. Ese
tiempo depende de la conexión y del servidor; no es una medición de Railway.
El muestreo reduce la resolución temporal y WebP usa compresión con pérdida.
No se garantiza una tasa de cuadros específica en todos los dispositivos.

Los PNG originales siguen en `public`, por lo que Vite también los copia a
`dist`: se reduce la transferencia al navegador, no el tamaño total del
despliegue. Separar los originales del directorio público puede abordarse
después si interesa reducir el artefacto de Railway.

## Referencias públicas consultadas

- [raghunandhanvr/airpods-scroll](https://github.com/raghunandhanvr/airpods-scroll/blob/2818f99da521d50df3e5ab7397a61d76ab1958dd/src/components/background/Back.jsx):
  precarga de una secuencia de 148 JPG y dibujo por `requestAnimationFrame`.
  Su código dibuja después de cambiar `src` sin esperar decodificación; se tomó
  como referencia de la técnica, no se copió ese comportamiento.
- [shaw4dev/airpods-scroll-animation](https://github.com/shaw4dev/airpods-scroll-animation/blob/ff7f240f9e55379b96d8d091b8091cef348ac1e4/src/App.jsx):
  secuencias de 101 y 50 imágenes usando `canvas-scroll-clip`. Ilustra una escala
  de recursos bastante menor que los 1.440 PNG originales.

No se instaló ninguna skill ni dependencia de estos repositorios. La solución
usa GSAP existente y APIs del navegador.

## Reproducción y validación local

```sh
cd /workspace/Jokerweb
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

Para regenerar los WebP, con Pillow disponible:

```sh
python3 scripts/optimize_scroll_frames.py
```

Comprobaciones del cambio:

```sh
node --test src/services/sequenceFrameStore.test.js
npm run lint
npm run build
```

Las cuatro pruebas del gestor cubren límites de concurrencia, reutilización
sin descargas adicionales, cambio rápido de destino, liberación de imágenes,
errores y la imagen estática de movimiento reducido.

La validación en Chromium incluyó caché HTTP desactivada, CPU ralentizada 4×,
scroll durante la preparación inicial y saltos adelante/atrás en escritorio y
móvil. Después de preparar la secuencia se desconectó la red: no hubo nuevas
solicitudes de fotogramas ni excepciones, y el fotograma dibujado alcanzó el
solicitado. También se comprobó el mensaje de error ante un 404 y la carga de
una sola imagen con movimiento reducido. La compilación conserva el aviso
preexistente de un bundle JavaScript superior a 500 kB.
