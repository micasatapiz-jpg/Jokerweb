# Fotos de productos con texto legible

Rama de revisión: `codex/productos-textos-legibles`, basada en `codex/scroll-unificado-fluido` (`c2f4c84`), que conserva la animación de `inicio-scroll-unificado`.

Se revisaron las 34 fotos activas de productos y las seis cabeceras de categoría. Se editaron 28 fotos y cinco cabeceras para reemplazar pseudoletras, monogramas ambiguos y anuncios sin contenido por ejemplos genéricos legibles, manteniendo materiales, iluminación, perspectiva y paleta de cada escena.

| Categoría | Ejemplos de texto | Fotos editadas |
| --- | --- | --- |
| Letreros | RESTAURANTE, BOUTIQUE, CLÍNICA, HOTEL | 6 + cabecera |
| Letras 3D | BOTICA, MODA, CAFÉ, HOTEL | 6 + cabecera |
| Gran formato | RESTAURANTE / COCINA PERUANA, CENTRO COMERCIAL, ENCUENTRO EMPRESARIAL | 6 + cabecera |
| Viniles | BOTICA, RESTAURANTE, BOUTIQUE, FARMACIA / ENTREGA A DOMICILIO; PERFUMERÍA en cabecera | 4 + cabecera |
| Señalética | RECEPCIÓN, OFICINAS | 1 |
| Eventos | CELEBRACIÓN, FERIA EMPRESARIAL, CUIDADO PERSONAL, EXPOSICIÓN / ARTE Y DISEÑO, CAFÉ | 5 + cabecera |

Se conservaron el mural botánico y el vinil transparente botánico, los cuatro ejemplos de señalética con pictogramas reconocibles y la cabecera de señalética. Sus dibujos sí representan decoración, accesibilidad u orientación; no son pseudotexto.

Las ediciones se hicieron con el editor de imágenes usando cada foto original como referencia. Se mantienen los nombres de los archivos WebP importados por la aplicación; los PNG antiguos que no se muestran no se reemplazaron. Los nombres genéricos son ejemplos visuales, no marcas nuevas ni cambios a los datos del negocio. La configuración de WhatsApp, los textos de la página y la animación permanecen como en la rama base.

Los 33 archivos se exportaron como WebP con calidad 85: su peso conjunto pasó de 5.86 MB a 4.75 MB, una reducción del 19 %. Se conservaron las dimensiones y orientación; la cabecera de viniles pasó de 1805 a 1806 píxeles de ancho, sin recortar la escena.

## Validación

- `npm run build` y `npm run lint` completados correctamente.
- Revisión visual de las 33 ediciones, incluyendo palabras principales, perspectiva, materiales e iluminación.
- Chromium sobre la compilación de producción: siete páginas en escritorio (1440 × 900) y móvil (390 × 844), todas las imágenes cargadas, sin errores JavaScript ni desbordamiento horizontal.
- 68 aperturas de detalles de producto: imagen ampliada cargada, cierre con Escape y enlace de WhatsApp presente. No se enviaron mensajes.

## Revisar localmente

Desde una copia del repositorio:

```sh
git fetch origin
git switch codex/productos-textos-legibles
npm ci
npm run dev
```

Abrir la dirección que imprime Vite, normalmente `http://localhost:5173`. Revisar `/catalogo` y las seis páginas `/servicios/letreros`, `/servicios/letras-3d`, `/servicios/gran-formato`, `/servicios/viniles`, `/servicios/senaletica` y `/servicios/eventos`, incluyendo la vista ampliada de las fotos. La comparación contra `codex/scroll-unificado-fluido` muestra únicamente esta revisión de imágenes.
