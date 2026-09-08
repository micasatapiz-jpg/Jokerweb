# Ficha de producto — completar por el propietario

No hay productos ni tarifas reales precargados por este documento. Completa una ficha por
producto y entrega casos de cálculo cuyo resultado conozcas. No uses los fixtures como tarifas.

## Información comercial

| Campo | Respuesta del propietario |
| --- | --- |
| PRODUCTO / código interno | Por completar |
| NOMBRE COMERCIAL / nombres con que lo piden | Por completar |
| CATEGORÍA | Por completar |
| CÓMO SE VENDE: UNIT, AREA, LINEAR, FIXED o PACKAGE | Por completar |
| UNIDAD BASE y unidades aceptadas | Por completar |
| CAMPOS OBLIGATORIOS / pregunta y tipo de cada uno | Por completar |
| CAMPOS OPCIONALES / pregunta y tipo | Por completar |
| VARIANTES: opciones cerradas y tarifa de cada una | Por completar |
| ADICIONALES: opcionales, precio por unidad o por pedido | Por completar |
| REGLA DE PRECIO / tarifa base / preparación | Por completar |
| MÍNIMOS Y MÁXIMOS de cantidad, medidas e importe | Por completar |
| CANTIDAD: entera/fraccionaria; campo o constante explícita | Por completar |
| IMPUESTO: porcentaje; indicar si precios recibidos lo incluyen | Por completar |
| VIGENCIA de tarifa y días de vigencia del presupuesto | Por completar |
| ARCHIVOS NECESARIOS: uso, formatos, calidad, tamaño | Por completar |
| DISEÑO: incluido/adicional, brief, revisiones, condiciones | Por completar |
| INSTALACIÓN: incluida/adicional, ubicación, restricciones y viáticos | Por completar |
| PRODUCCIÓN: pago, arte y verificaciones requeridas | Por completar |
| ENTREGA: recojo/envío, plazos y confirmación del encargado | Por completar |
| REQUIERE HUMANO | Sí por defecto; especificar excepciones futuras |
| AUTO-COTIZAR | Mantener NO en este bloque |
| OBSERVACIONES y ejemplos de pedidos válidos/no válidos | Por completar |
| Tres pedidos de ejemplo con desglose y total esperado | Por completar |

## Cómo se representa, sin cambiar Agent Core

`Product` guarda nombre/categoría. `ProductConfiguration.rules` guarda esta ficha traducida a
JSON validado y versionado. `PriceRule.commercialRates` guarda la tarifa referenciada por UUID
en `commercialPricing.tariffId`. Publicar una nueva versión requiere `ProductConfigurationService.publish`
con actor OWNER construido por un adaptador autenticado, no por el texto del cliente.

No se añadió un endpoint público de carga. El validador siguiente NO autoriza ni publica.
En el próximo bloque se cargará primero en una BD local, con revisión humana, comprobando
tenant/producto/UUID y probando los resultados esperados. Después se preparará la migración
respaldada de producción; no ejecutar `prisma db push` contra Railway como atajo.

### Modalidades del motor GENERIC_V1

| Modo | Base por unidad antes de componentes |
| --- | --- |
| UNIT | Tarifa unitaria |
| AREA | Ancho canónico × alto canónico × tarifa |
| LINEAR | Longitud canónica × tarifa |
| FIXED | Tarifa fija; cantidad constante 1 |
| PACKAGE | Tarifa de variante seleccionada explícitamente |

Se suma a la base cada adicional PER_UNIT seleccionado; se multiplica por cantidad y se
añaden setupPrice y adicionales PER_ORDER una sola vez. Se aplica el mínimo de subtotal;
se rechaza si excede el máximo. Se calcula impuesto sobre ese subtotal. No hay descuentos.
Moneda: la configurada en Tenant. Tarifas de entrada **antes de impuesto**, no incluyéndolo.
Importes redondeados a dos decimales con aritmética decimal. unitPrice del documento es
el subtotal prorrateado por cantidad; el snapshot conserva el desglose exacto.

Diseño/instalación/viáticos deben estar incluidos explícitamente en setup/tarifa o representados
como adicionales de campos booleanos configurados. Si dependen de zona/distancia, expresar
opciones discretas aprobadas o requerir revisión; no existe cálculo automático de rutas/taxis.
Si la regla real no cabe en estas cinco modalidades/componentes, no forzarla: dejar revisión
humana y ampliar el motor con otra regla versionada y pruebas antes de habilitarla.

### Contrato JSON de carga

Preparar un archivo UTF-8 con claves `product`, `configuration`, `tariff`.
No se incluye un JSON con precios inventados que pueda cargarse accidentalmente.

- `product`: `name`, `slug`, `category` (strings).
- `configuration.isActive`: boolean; `validFrom`/`validUntil`: ISO UTC o null.
- `configuration.quotationRules`: `pricingEngine: "GENERIC_V1"`, `validityDays` (1–90),
  `requiredFields`, `optionalFields`, `fields` (diccionario: tipo, pregunta, label opcional,
  límites y choices cuando corresponda).
- `configuration.commercialPricing`: `ruleRef: "GENERIC_V1"`, `tariffId` UUID,
  `saleMode`, `quantity`, `measurements`, `variant`, `addOns`, `minimumSubtotal`, `maximumSubtotal`.
- `quantity`: `field` o `constant` (exactamente uno no-null), `integer`, `min`, `max`.
- `measurements`: cero entradas para UNIT/FIXED/PACKAGE, una para LINEAR, dos para AREA.
  Cada entrada: `field`, `unitField`, `canonicalUnit`, `acceptedUnits`, `conversionRules`, `min`, `max`.
  Cada eje usa un campo de unidad independiente. El orden AREA es ancho y alto.
  Unidades soportadas: m, cm, mm, in, ft; aceptar solo las elegidas por el negocio. Conversión
  multiplicativa exacta a unidad canónica: no se aceptan factores arbitrarios o ausentes.
- `variant`: null o `{ field, options }`; obligatoria en PACKAGE. Su tarifa reemplaza la unitaria.
- `addOns`: lista `{ field, rateKey, basis }`; field booleano, basis PER_UNIT/PER_ORDER.
  Ausente o null significa no solicitado; nunca se agrega una tarifa desde texto libre.
- `tariff`: `unitPrice`, `setupPrice`, `variants` (opción → importe), `addOns` (rateKey → importe),
  `taxPercent`. Todas las opciones/adicionales configuradas deben tener tarifa.
- `fileRules`, `designRules`, `installationRules`, `productionRules`, `deliveryRules`: según
  `server/src/agent-core/product-configuration.schema.ts`. No usar instrucciones libres como fórmulas.
- `autoQuoteEnabled: false`, `requiresHumanReview: true` y `automaticProductionStart: false`.

Las medidas y cantidades tienen límites técnicos además de los comerciales. Cantidad se
almacena hasta dos decimales; los límites comerciales se evalúan sobre medidas canónicas.
Las claves de campos no pueden declarar precios, pagos, estados, permisos o aprobaciones.

## Validación local sin escribir datos

Desde PowerShell, sustituyendo la ruta del JSON que completaste:

```powershell
Set-Location 'C:\Users\Fernando\Documents\JOKERWEB\server'
npx tsx scripts/validate-product-configuration.ts 'C:\ruta\producto-completado.json'
```

Un resultado válido comprueba estructura, no exactitud comercial, propiedad del UUID ni
existencia de la tarifa en una BD. La carga posterior asignará IDs reales, comprobará las
relaciones y ensayará tus ejemplos antes de aprobar y publicar una versión.
