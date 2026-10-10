# Resultados de Trivy

Análisis del 10 de octubre de 2026 sobre el commit
`257fc52b1380b0df65ec01619f1b196bd55d1cf3`, con Trivy 0.75.0. Se ejecutó en el
entorno Linux de Codex, **no en la PC Windows del usuario**: esta sesión no tenía
una terminal conectada a ese equipo. No se modificó ni desplegó la aplicación.

Se revisaron dependencias, secretos y configuraciones del repositorio, y la imagen
final `jokerweb-landing-audit`, ID
`sha256:add3d68fd723cf882c23df5cc89710a6a5a6f59d4e6789c293ea03fc82ea2d5c`.
La imagen incluye Caddy 2.11.7, Go 1.26.8 y Alpine 3.23.6. La base de
vulnerabilidades oficial se descargó de `ghcr.io/aquasecurity/trivy-db:2`;
su actualización fue el 9 de octubre a las 20:03, hora de Lima.

## Resumen

| Alcance | Altas | Medias | Bajas | Sin clasificación |
| --- | ---: | ---: | ---: | ---: |
| Frontend, incluyendo dependencias de desarrollo | 0 | 0 | 0 | 0 |
| Dependencias de la imagen pública | 4 | 8 | 1 | 7 |
| Backend heredado, incluyendo desarrollo | 10 | 6 | 0 | 0 |

Son hallazgos por dependencia: una misma CVE puede aparecer en dos componentes.
Las cuatro alertas altas de la imagen corresponden a **tres CVE distintas**.
El backend no está instalado en la imagen pública. Sus resultados no describen
la exposición de la landing actual, pero impiden recomendar su publicación.

Trivy también reportó un aviso bajo por falta de `HEALTHCHECK` Docker en la imagen
y el Dockerfile. Railway tiene un healthcheck externo `/healthz` en `railway.toml`.
En `Dockerfile.sales` detectó ejecución como root (alto) y falta de HEALTHCHECK
(bajo); ese archivo está reservado a desarrollo y no es el despliegue público.

No se detectaron secretos en los archivos examinados ni en la imagen. Trivy no
revisó commits eliminados ni todo el historial Git; ese trabajo requiere una
herramienta como Gitleaks y disponer del historial completo.

## Prioridad de la imagen pública

| Hallazgo | Componente | Corrección que indica la base |
| --- | --- | --- |
| [CVE-2026-78667](https://avd.aquasec.com/nvd/cve-2026-78667), alto: consumo excesivo de CPU al procesar numerosos rangos HTTP | Go stdlib 1.26.8 | Go 1.26.9 o 1.27.2 |
| [CVE-2026-78669](https://avd.aquasec.com/nvd/cve-2026-78669), alto: denegación de servicio mediante HTTP/2 SETTINGS | Go stdlib 1.26.8 y `golang.org/x/net` 0.59.0 | Go 1.26.9/1.27.2 y x/net 0.60.0 |
| [CVE-2026-97031](https://avd.aquasec.com/nvd/cve-2026-97031), alto: denegación de servicio al procesar extensiones TLS ECH | Go stdlib 1.26.8 | Go 1.26.9 o 1.27.2 |
| [CVE-2026-85091](https://avd.aquasec.com/nvd/cve-2026-85091), medio: desbordamiento de búfer | zlib 1.3.2-r0 | zlib 1.3.2-r1 |

La alerta de **Range** merece atención antes de publicar: se comprobó que el
[servidor de archivos de Caddy 2.11.7](https://github.com/caddyserver/caddy/blob/v2.11.7/modules/caddyhttp/fileserver/staticfiles.go)
llama a `http.ServeContent`, función incluida en la descripción de la CVE.
Existe una ruta potencial hacia el código afectado al servir archivos. No se
ejecutaron cargas maliciosas ni se confirmó una explotación contra Railway.

La configuración actual desactiva el HTTPS automático de Caddy y no habilita
h2c; Railway termina HTTPS delante del contenedor. Esto reduce la exposición
directa de las alertas TLS/HTTP2 en este servidor. No equivale a eliminar las
dependencias vulnerables ni a certificar el proxy de Railway.

Otros avisos corresponden a funciones de plantillas, multipart, clientes HTTP y
Windows que no se demostró que utilice la landing. Los siete de severidad
desconocida siguen pendientes de revisión; no se consideran inocuos por carecer
de puntuación.

Se volvió a descargar `caddy:2-alpine` y su digest seguía siendo
`sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f`.
Por tanto, reconstruir con ese mismo tag no garantiza corregir estos hallazgos.
La corrección requiere una imagen/binario compilado con las versiones parcheadas,
seguido de un nuevo análisis y pruebas. Como mitigación de Range puede evaluarse
rechazar peticiones multirrango, comprobando que los rangos simples y la secuencia
sigan funcionando. Este análisis no aplicó esa modificación.

## Backend heredado

El análisis completo detectó 16 alertas de dependencias: 10 altas y 6 medias.
El análisis excluyendo desarrollo detectó 15: 9 altas y 6 medias. Entre ellas:

- `@nestjs/platform-fastify` 12.0.1: bypass de middleware; la base señala 12.0.2.
- `fastify` 5.12.1: bypass de autenticación/validación; señala 5.12.2 para las
  alertas altas y 5.12.5 para otra alerta de denegación de servicio.
- `brace-expansion`, `deepmerge-ts` y `mysql2`: ver versiones y avisos en el JSON.

Las cifras difieren de `npm audit` porque las herramientas usan fuentes,
clasificación y agrupación distintas. Ninguna reemplaza la revisión de las rutas
sin autenticación identificadas anteriormente. El backend debe continuar fuera
del despliegue público.

## Repetir el análisis en Windows

En PowerShell, instalar la herramienta gratuita desde el paquete verificado de
[WinGet](https://github.com/microsoft/winget-pkgs/blob/master/manifests/a/AquaSecurity/Trivy/0.75.0/AquaSecurity.Trivy.installer.yaml):

```powershell
winget install --id AquaSecurity.Trivy --exact --source winget
```

Abrir una terminal nueva para que se actualice PATH, entrar en la carpeta de
Jokerweb y ejecutar:

```powershell
trivy --version
New-Item -ItemType Directory -Force .security-reports | Out-Null
trivy fs --scanners vuln,misconfig,secret --include-dev-deps --offline-scan --skip-files Dockerfile.dockerignore --skip-dirs node_modules,server/node_modules,dist,.git,public/secuencias,src/assets,server/src/generated,.security-reports --format json --output .security-reports/repository.json .
```

Para revisar el servidor que se publicará, hace falta Docker Desktop activo:

```powershell
docker build -t jokerweb-security .
trivy image --scanners vuln,misconfig,secret --image-config-scanners misconfig,secret --format json --output .security-reports/landing-image.json jokerweb-security
```

El escáner y sus bases se ejecutan en tu PC; no requieren Railway. La primera
descarga de la base fue aproximadamente 121 MiB comprimidos y 1,4 GiB al extraerla
en esta revisión. La versión y las cifras pueden cambiar al actualizar la base.

Los JSON brutos quedan locales y `.security-reports` está excluido de Git: pueden
contener fragmentos de código o valores sensibles si se encuentran secretos.
Los [resultados del repositorio](trivy-repository.json) y de la
[imagen pública](trivy-landing-image.json) incluidos aquí conservan IDs, versiones
y descripciones, sin valores de secretos ni fragmentos de código.

## Alcance y límites

Se excluyeron binarios de imágenes/secuencias, dependencias instaladas, `dist`,
`.git` y código Prisma generado. Se analizaron ambos lockfiles con dependencias
de desarrollo. `Dockerfile.dockerignore` se excluyó porque Trivy lo interpretó
erróneamente como Dockerfile. Las políticas de configuración fueron las
embebidas en Trivy 0.75.0; la base de vulnerabilidades sí se descargó actualizada.

Trivy detecta vulnerabilidades conocidas y patrones de configuración/secretos.
No demuestra por sí solo la explotabilidad, no es un análisis semántico completo
de React y no sustituyó un pentest del sitio publicado. No hubo acceso al dominio
ni a la cuenta Railway ni a las variables y archivos que existan solo en tu PC.
