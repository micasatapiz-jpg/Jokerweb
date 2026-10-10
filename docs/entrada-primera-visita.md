# Entrada de primera visita

La entrada usa **Chase**, la animación CSS existente de [SpinKit](https://github.com/tobiasahlin/SpinKit), de Tobias Ahlin. Fuente consultada: commit `742a71277c49b69053b5beb9fad80d720840a2ab`, sección Chase de `spinkit.css`. Se adaptaron tamaño y color a Joker; las animaciones y sus tiempos proceden del proyecto. La licencia MIT y su atribución se conservan en `docs/licenses/SpinKit.txt`. El CSS se sirve con el sitio, sin dependencias ni peticiones a GitHub durante las visitas.

- Primera visita sin caché: indicador circular dorado, marca y progreso real. Desaparece cuando los fotogramas están preparados, con una salida de 200 ms. Se eliminó la espera mínima artificial de tres segundos.
- Una carga completa guarda `joker-intro-seen-v1=1` en localStorage. La presentación no se repite al recargar, volver desde otra página ni cambiar la variante móvil/escritorio.
- Si ya estaban los paquetes en caché de una versión anterior, también se omite la presentación y se guarda el indicador de visita.
- En visitas posteriores, el primer fotograma disponible se dibuja mientras se prepara el resto. Si la caché fue borrada o faltan paquetes, solo aparece un aviso discreto de progreso, sin repetir la presentación ni dar por lista una secuencia incompleta.
- Si falla la descarga, hay un mensaje estático y reintento; no se marca como completada una primera visita fallida.
- Movimiento reducido omite la presentación y conserva el fotograma final estático. Si localStorage está bloqueado, el indicador de visita se conserva durante la sesión de la aplicación; la caché también permite omitir la entrada.

Se mantiene el encuadre corregido del primer clip móvil, los otros clips, las 33 fotos editadas y la configuración de WhatsApp.

## Validación

`npm run build`, `npm run lint` y las siete pruebas de secuencias y caché completados correctamente. Chromium en escritorio y móvil verifica: primera entrada, segunda visita sin presentación ni descarga de paquetes, migración desde caché existente, caché borrada sin repetir la presentación, scroll sin red después de cargar, fallo con reintento y movimiento reducido.

## Descargar y ejecutar un ZIP

Una carpeta extraída de un ZIP de GitHub no tiene `.git`; `git pull` y `git fetch` no funcionan allí. Para actualizarla, descargar nuevamente la [rama de revisión](https://github.com/micasatapiz-jpg/Jokerweb/archive/refs/heads/codex/productos-textos-legibles.zip) y extraerla en una carpeta nueva. Desde la carpeta que contiene `package.json`:

```sh
npm ci
npm run dev
```

Para poder actualizar futuras versiones con Git, clonar el repositorio con `git clone --branch codex/productos-textos-legibles https://github.com/micasatapiz-jpg/Jokerweb.git Jokerweb-revision` en una carpeta nueva.
