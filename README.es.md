# ARCLUME

> Arclume turns complex projects into clear visual narratives.

![ARCLUME banner](brand/banners/readme-header-dark.svg)

**ARCLUME 1.0.2 es la versión estable actual.**

ARCLUME es un motor local-first que convierte proyectos, documentos y URLs HTTPS en narrativas visuales con procedencia y presentaciones profesionales.

**Salidas:** HTML autocontenido • PDF • PPTX editable

---

## Qué es ARCLUME

ARCLUME transforma una entrada — un directorio de proyecto, un documento o una página web — en una presentación validada. Cada afirmación en el deck remite a una fuente real, y el análisis está ligado por digest al material exacto ingerido: el deck solo puede describir lo que realmente se analizó.

Desde el modelo de conocimiento en adelante todo es determinista: la misma entrada produce la misma presentación, byte a byte.

## Por qué ARCLUME

- **Sin contenido inventado** — la generación es determinista y el paso de razonamiento queda aislado detrás de un contrato estricto, validado por esquema.
- **Trazabilidad de extremo a extremo** — las afirmaciones llevan referencias a fuentes, localizadores y citas textuales; los artefactos quedan ligados por hashes y sellados con recibos.
- **Local-first** — ARCLUME no tiene cuentas alojadas, analíticas ni almacenamiento remoto propio; la Web UI funciona solo en loopback. La ingesta de URLs realiza únicamente el acceso de red solicitado explícitamente, y la privacidad del análisis externo depende del agente o proveedor que elijas.
- **Agent-ready** — un agente externo produce el análisis a través de un contrato basado en archivos; no se incluye ni requiere ningún SDK de modelo.

## Qué puede hacer

- Ingesta proyectos, documentos y URLs en documentos fuente normalizados, con hash de procedencia.
- Construye un modelo **ProjectKnowledge** cuyas afirmaciones se clasifican como `FACT` / `INFERENCE` / `UNKNOWN` / `RECOMMENDATION` y están respaldadas por evidencia.
- Verifica la evidencia de fuente de forma hermética (verificación Git sin red) — un hecho solo está *Verificado* cuando su archivo, rango de líneas y revisión coinciden.
- Inspecciona cada afirmación en el **Inspector de evidencia**: insignias de verificación, rutas de fuente relativas, rangos de líneas, revisiones.
- Planifica la narrativa y las diapositivas de forma determinista para uno de **seis presets de audiencia** y **nueve tipos de deck** — un mensaje clave por diapositiva.
- Reconstruye cualquier número de decks a partir del mismo ProjectKnowledge sin volver a ejecutar el análisis de IA.
- Dirige los visuales en **siete familias de diagramas**: Arquitectura, Flujo de trabajo, Secuencia, Flujo de datos, Ciclo de vida, Línea de tiempo y Hoja de ruta — mediante motores nativos y ARCLUME Visual Engine vendored.
- Renderiza un HTML de presentación único, autocontenido — offline, controlado por teclado, accesible.
- Exporta a PDF y PPTX editable como bundles atómicos con recibos.
- Demuestra el resultado renderizado con Visual QA en Chromium: capturas, geometría, contraste, comprobaciones de red-cero y consola-cero.
- Dirige todo desde la CLI, la interfaz web local o un flujo de agente.

## Cómo funciona

```text
PROJECT / DOCUMENT / URL
        ↓
SAFE INGESTION       acotada, sin ejecución
        ↓
ANALYSIS             agente externo, o stub heurístico offline
        ↓
PROJECT KNOWLEDGE    modelo validado, con evidencia
        ↓
NARRATIVE PLANNING   historia adaptada a la audiencia
        ↓
SLIDE PLANNING       un mensaje clave por diapositiva
        ↓
VISUAL DIRECTION     bloques, layouts, temas, diagramas
        ↓
ARCLUME DECK         IR de deck validado
        ↓
HTML / PDF / PPTX    render canónico, export atómico, recibos
```

Todo desde **Project Knowledge** en adelante es una función pura y determinista de sus entradas. La única etapa que puede razonar es **Analysis**, alcanzada a través de un límite explícito — el resto del pipeline vuelve a validar su salida.

## Capturas

| | | |
| --- | --- | --- |
| ![Workspace](docs/media/release-1.0.2/01-workspace.png) | ![Inspector de evidencia](docs/media/release-1.0.2/02-evidence-inspector.png) | ![Audiencia y tipos de deck](docs/media/release-1.0.2/03-audience-deck-type.png) |
| ![Arquitectura](docs/media/release-1.0.2/04-architecture.png) | ![Vista previa del deck final](docs/media/release-1.0.2/05-final-deck-preview.png) | ![Exportación](docs/media/release-1.0.2/06-export.png) |

El flujo, de izquierda a derecha: crea un workspace, inspecciona el
conocimiento respaldado por evidencia, elige una audiencia y un tipo de deck,
previsualiza el deck y exporta.

## Entradas

- Directorios / proyectos (recorrido con denylist y respeto a `.gitignore`)
- Markdown
- Texto plano
- JSON
- YAML (esquema core seguro)
- PDF (solo capa de texto — sin OCR, scripts incrustados nunca ejecutados)
- DOCX (macros y paquetes OLE/embebidos rechazados)
- URLs `https://` (a través del límite SSRF endurecido — ver Seguridad)

## Salidas

| Salida | Descripción |
| --- | --- |
| `ProjectKnowledge` JSON | El modelo de conocimiento validado de la entrada. |
| `ArclumeDeck` JSON | La representación intermedia de deck validada. |
| Presentación HTML | Un archivo autocontenido offline con visor accesible por teclado. |
| Bundle de exportación PDF | Directorio atómico: `deck.pdf` + `export-receipt.json`. |
| Bundle de exportación PPTX | Directorio atómico: `deck.pptx` editable + `export-receipt.json`. |
| Recibos | Manifiestos criptográficos ligando hashes de artefacto, identidad de deck, versiones y procedencia. |
| Artefactos de Visual QA | Capturas por diapositiva, hallazgos y recibo de QA. |

Un **bundle de exportación** es un directorio que ARCLUME prepara, valida, hashea y publica atómicamente: el artefacto más un recibo que liga su SHA-256, la identidad del deck, la versión del exportador y la procedencia de diagramas. Los bundles rechazan sobrescribir salidas existentes y pueden re-verificarse después con `arclume validate <bundle>`.

## Instalación

ARCLUME se distribuye como builds de Windows listos para ejecutar — no hace
falta instalar Node.js, npm ni un navegador. Tanto el instalador como el ZIP
portable incluyen su propio runtime de Node.js y su propio Chromium, por lo que
las exportaciones (HTML, PDF, PPTX) funcionan totalmente offline.

**Versión estable actual: ARCLUME 1.0.2**

| Descarga | Qué es |
| --- | --- |
| [ARCLUME-Setup-1.0.2.exe](https://github.com/kerwilgil/arclume/releases/download/v1.0.2/ARCLUME-Setup-1.0.2.exe) | Instalador de Windows (por usuario, sin permisos de administrador) |
| [ARCLUME-1.0.2-portable.zip](https://github.com/kerwilgil/arclume/releases/download/v1.0.2/ARCLUME-1.0.2-portable.zip) | Build portable autocontenido |
| [SHA256SUMS.txt](https://github.com/kerwilgil/arclume/releases/download/v1.0.2/SHA256SUMS.txt) | Checksums SHA-256 de ambos artefactos |

Ambos artefactos también están disponibles en la
[página de GitHub Releases](https://github.com/kerwilgil/arclume/releases) para
cada versión etiquetada. Las builds no están firmadas digitalmente, por lo que
SmartScreen de Windows puede advertir en el primer arranque.

**1. Instalador (recomendado).** Ejecuta `ARCLUME-Setup-1.0.2.exe`. Instala por
usuario en `%LOCALAPPDATA%\Programs\ARCLUME`, crea un acceso directo en el
menú Inicio (y opcionalmente en el escritorio) y abre ARCLUME en tu navegador.

**2. Portable.** Descomprime `ARCLUME-1.0.2-portable.zip` donde sea — incluidas
rutas con espacios o un disco extraíble — y haz doble clic en `ARCLUME.exe`.

Verifica una descarga contra los checksums publicados:

```powershell
Get-FileHash ARCLUME-Setup-1.0.2.exe -Algorithm SHA256
Get-FileHash ARCLUME-1.0.2-portable.zip -Algorithm SHA256
```

O, en Linux/macOS con `sha256sum`:

```bash
sha256sum -c SHA256SUMS.txt
```

> El repositorio de desarrollo (source) es privado y **no** se distribuye a
> través de este repositorio público. Este repositorio existe para publicar las
> releases, la documentación pública y los assets de marca.

## Inicio rápido

Una vez que ARCLUME está en marcha, crea un workspace a partir de un proyecto,
documento o URL, y empieza con la vista previa heurística offline:

```bash
arclume analyze ./project --reasoner stub --out knowledge.json
arclume build knowledge.json --preset executive --format html,pdf,pptx
```

El stub es una **vista previa heurística y offline**: determinista, útil para tests de humo e iteración rápida, y etiquetado explícitamente como tal por la CLI. **No es análisis de grado agente**. Para decks de producción, usa el flujo de agente abajo.

## Flujo de trabajo con agente

ARCLUME no incluye ningún SDK de modelo. Un agente externo realiza el análisis a través de un contrato estricto de archivos ligado por digest:

```bash
# 1. Escribe la petición de análisis determinista (se detiene aquí — sin razonar)
arclume analyze ./project --prepare-analysis analysis-request.json
```

El agente lee `analysis-request.json` — ids de documentos, rutas, esquemas y contenido — y produce un sobre `arclume/agent-analysis` cuyo `sourceDigest` coincide verbatim con la petición.

```bash
# 2. Consume el resultado ligado → ProjectKnowledge validado
arclume analyze ./project \
  --analysis-result analysis-result.json \
  --out project-knowledge.json

# 3. Construye el deck
arclume build project-knowledge.json \
  --preset executive \
  --format html,pdf,pptx
```

Un sobre desactualizado es rechazado (`reasoner/source-digest-mismatch`): el digest liga el análisis al contenido exacto de la entrada. El contrato completo está documentado en [docs/CLI.md](docs/CLI.md).

## CLI

```text
arclume analyze <input...>   ingesta → análisis → ProjectKnowledge
arclume build <knowledge>    knowledge → deck → bundles HTML / PDF / PPTX
arclume validate <path>      re-verifica un bundle, manifiesto o knowledge
arclume presets              lista presets de audiencia/tema
arclume watch <path>         bucle de rebuild heurístico offline
arclume web                  interfaz web local (solo loopback)
arclume --help               uso completo
```

Salida máquina-legible con `--json`; códigos de salida `0` éxito, `1` uso, `2` build/validación, `3` rechazo seguridad.

## Interfaz web local

```bash
arclume web
```

Arranca la interfaz local opcional en `http://127.0.0.1:3210` (solo loopback). Dirige los mismos caminos de código que la CLI sobre un espacio de trabajo local:

```text
source → analysis → knowledge → build → preview → export
```

No es un servicio hospedado ni un dashboard en la nube: sin cuentas, sin sync, sin almacenamiento remoto — el navegador habla con un servidor loopback en tu máquina, protegido por token por sesión, y el preview renderiza el HTML canónico del deck byte a byte. El sidebar también tiene un manual de **Ayuda** offline permanente y **Configuración** (**Idioma**: English / Español; **Apariencia**: Sistema / Claro / Oscuro) — ambos se guardan localmente y se aplican de inmediato, sin depender de ningún workspace.

## Watch

```bash
arclume watch ./project --reasoner stub --preset executive
```

Rebuilds con debounce del HTML del deck mientras iteras. Watch es un bucle explícito de **vista previa heurística / offline rápida**: nunca ejecuta el flujo de agente y nunca produce análisis autoritativo. Para decks de producción, ejecuta el flujo de agente y `arclume build`.

## Audiencia y tipos de deck

Seis **presets de audiencia** definen para quién es el deck — profundidad
narrativa, densidad técnica y visibilidad de evidencia:

| Audiencia | Intención |
| --- | --- |
| `executive` | Decisiones, impacto, recomendaciones; mínimo detalle técnico |
| `technical` | Arquitectura, flujos, restricciones, riesgos; detalle técnico denso |
| `product` | Problema, usuarios, capacidades, flujos, resultados |
| `client` | Claridad, beneficios, estado, entregables |
| `investor` | Oportunidad, diferenciación, defendibilidad, hoja de ruta |
| `internal-review` | Hallazgos, incertidumbre, riesgos y máxima visibilidad de evidencia |

Nueve **tipos de deck** definen el arco narrativo con independencia de la audiencia:

`project-overview`, `architecture-review`, `technical-deep-dive`,
`executive-brief`, `proposal`, `status-report`, `migration-plan`,
`product-overview`, `incident-postmortem`.

Audiencia y tipo se combinan: `technical + architecture-review` es profundo y
estructural, mientras que `executive + architecture-review` es la misma
estructura resumida para decisiones. Combínalos con `--audience` / `--deck-type`.

## Trazabilidad y evidencia

- Las afirmaciones son `FACT` / `INFERENCE` / `UNKNOWN` / `RECOMMENDATION`; un `FACT` sin evidencia se degrada, nunca se mantiene en silencio.
- Cada afirmación lleva referencias a fuente con localizadores y citas textuales.
- Los artefactos están ligados por hash entre etapas: análisis ↔ entrada (`sourceDigest`), deck ↔ knowledge (`provenance`), exports ↔ deck (recibos).
- `arclume validate` re-verifica bundles de exportación y manifiestos de entrega.

## Seguridad — local-first por diseño

- Nunca ejecuta código del proyecto analizado.
- Nunca ejecuta JavaScript de PDF; solo parsing de capa de texto.
- Rechaza macros y paquetes OLE/embebidos en DOCX.
- La ingesta de URLs corre tras un límite SSRF endurecido: DNS fijado, política de esquema, presupuestos de bytes, sin downgrade.
- El render canónico y la exportación funcionan totalmente offline.
- La Web UI escucha solo en loopback (`127.0.0.1`).
- Sin analíticas, sin cuenta en la nube, sin almacenamiento remoto.
- Validación de salida, recibos y liga de procedencia en cada entregable.

El modelo de amenazas completo y las garantías de ingesta están en [SECURITY.md](SECURITY.md).

## Arquitectura

```text
INPUT
  ↓
INGESTION          segura, acotada, sin ejecución
  ↓
ANALYSIS           límite Reasoner enchufable
  ↓
PROJECT KNOWLEDGE  modelo validado
  ↓
NARRATIVE          historia adaptada a audiencia
  ↓
SLIDE PLAN         un mensaje clave por diapositiva
  ↓
VISUAL DIRECTOR    bloques, layouts, temas, diagramas
  ↓
ARCLUME DECK       IR de deck validado
  ↓
RENDER / EXPORT    HTML canónico → PDF / PPTX
  ↓
VALIDATION         Visual QA, recibos, bundles verificables
```

ARCLUME es un core headless con clientes ligeros (CLI, Web UI, skill de agente): ninguna lógica vive solo en un cliente.

### Motores de diagrama

ARCLUME incluye el ARCLUME Visual Engine vendored para diagramas de arquitectura/flujo de trabajo soportados, junto a sus propios modelos deterministas nativos. La atribución y las licencias están en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Requisitos

Las builds de Windows (Instalador y Portable) **no requieren nada** — llevan su
propio runtime de Node.js y su propio Chromium.

Para un entorno de desarrollo desde source:

- Node.js **>= 20.16.0** (solo ESM).
- Chromium vía Playwright — requerido para exportación PDF y Visual QA:

```bash
npx playwright install chromium
```

## Windows

ARCLUME tiene dos vías de distribución.

**1. Instalador (para cualquier persona).** `ARCLUME-Setup-1.0.2.exe`, desde la
[página de release](https://github.com/kerwilgil/arclume/releases/tag/v1.0.2),
instala por usuario, sin permisos de administrador, y crea un acceso directo en
el menú Inicio (y opcionalmente en el escritorio). Al abrir ARCLUME, el
navegador se abre solo.

**2. Portable.** Descomprime `ARCLUME-1.0.2-portable.zip` donde sea y
haz doble clic en `ARCLUME.exe`.

Ambas llevan su propio runtime de Node.js y su propio Chromium: **no hay que
instalar nada más** — ni Node.js, ni npm, ni PowerShell 7, ni
`playwright install`. Las exportaciones (HTML, PDF, PPTX) funcionan sin
conexión.

Ver [docs/WINDOWS.md](docs/WINDOWS.md) para el layout de la distribución,
requisitos y solución de problemas.

> **Nota:** el instalador y el portable de Windows están publicados en la
> [página de releases](https://github.com/kerwilgil/arclume/releases). Las
> builds no están firmadas digitalmente, por lo que SmartScreen puede advertir
> en el primer arranque.

## Estado actual

| Área | Estado |
| --- | --- |
| Core (knowledge, deck IR, validación) | Estable |
| CLI | Estable |
| Web UI | Estable |
| Ingesta (PDF / DOCX / URL) | Estable |
| Export (HTML / PDF / PPTX) | Estable |
| Visual QA | Estable |
| Motor visual ARCLUME | Estable |

**ARCLUME 1.0.2 es la versión estable actual.** Consulta la
[página de release](https://github.com/kerwilgil/arclume/releases/tag/v1.0.2)
para las builds etiquetadas y sus checksums.

ARCLUME se llamó anteriormente ProjectDeck (referencia histórica únicamente).

## Documentación

- Referencia de CLI — [docs/CLI.md](docs/CLI.md)
- Guía de Windows — [docs/WINDOWS.md](docs/WINDOWS.md)
- Temas — [docs/THEMES.md](docs/THEMES.md)
- Visor — [docs/VIEWER.md](docs/VIEWER.md)
- Notas de release 1.0.0 — [docs/RELEASE_NOTES_1.0.0.md](docs/RELEASE_NOTES_1.0.0.md)
- Notas de release 1.0.2 — [docs/RELEASE_NOTES_1.0.2.md](docs/RELEASE_NOTES_1.0.2.md)
- Changelog — [CHANGELOG.md](CHANGELOG.md)
- Seguridad — [SECURITY.md](SECURITY.md)
- Avisos de terceros — [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- Releases — [GitHub Releases](https://github.com/kerwilgil/arclume/releases)

## Licencia

MIT — ver [LICENSE](LICENSE).