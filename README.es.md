# ARCLUME

> Arclume turns complex projects into clear visual narratives.

![ARCLUME banner](docs/assets/brand/readme-header-dark.svg)

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
- Planifica la narrativa y las diapositivas de forma determinista para la audiencia elegida — un mensaje clave por diapositiva.
- Dirige los visuales: 16 tipos de bloque, diagramas nativos (arquitectura, proceso, secuencia, línea de tiempo, hoja de ruta) y diagramas Archify (arquitectura, flujo de trabajo).
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

## Inicio rápido

Vista previa offline con el stub heurístico (tras construir desde el repositorio — ver [Instalación](#instalación)):

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

Un sobre desactualizado es rechazado (`reasoner/source-digest-mismatch`): el digest liga el análisis al contenido exacto de la entrada. El contrato completo está documentado en [SKILL.md](SKILL.md) y [docs/REASONER.md](docs/REASONER.md).

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

No es un servicio hospedado ni un dashboard en la nube: sin cuentas, sin sync, sin almacenamiento remoto — el navegador habla con un servidor loopback en tu máquina, protegido por token por sesión, y el preview renderiza el HTML canónico del deck byte a byte. El sidebar también tiene un manual de **Ayuda** offline permanente y **Configuración** (**Idioma**: English / Español; **Apariencia**: Sistema / Claro / Oscuro) — ambos se guardan localmente y se aplican de inmediato, sin depender de ningún workspace. Detalles en [docs/WEB_UI.md](docs/WEB_UI.md).

## Watch

```bash
arclume watch ./project --reasoner stub --preset executive
```

Rebuilds con debounce del HTML del deck mientras iteras. Watch es un bucle explícito de **vista previa heurística / offline rápida**: nunca ejecuta el flujo de agente y nunca produce análisis autoritativo. Para decks de producción, ejecuta el flujo de agente y `arclume build`.

## Presets

| Preset | Audiencia | Tema | Intención |
| --- | --- | --- | --- |
| `executive` | executive | executive | Deck orientado a decisiones |
| `technical` | technical | minimal | Deck denso en evidencia |
| `general` (default) | general | minimal | Default neutro |

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

El modelo de amenazas completo y garantías de ingesta están en [docs/SECURITY.md](docs/SECURITY.md); integridad de exportación y entrega en [docs/ATOMIC_DELIVERY.md](docs/ATOMIC_DELIVERY.md) y [docs/PHASE8.md](docs/PHASE8.md).

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

ARCLUME es un core headless con clientes ligeros (CLI, Web UI, skill de agente): ninguna lógica vive solo en un cliente. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Motores de diagrama

ARCLUME incluye un motor de diagrama Archify vendored para diagramas de arquitectura/flujo de trabajo soportados, junto a sus propios modelos deterministas nativos. Archify está vendored bajo `vendor/archify/` (v2.16.0, MIT — © tt-a1i / Cocoon AI). Detalles de integración en [docs/DIAGRAM_ENGINES.md](docs/DIAGRAM_ENGINES.md); atribución y licencias en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Requisitos

- Node.js **>= 20.16.0** (solo ESM).
- Chromium vía Playwright — requerido para exportación PDF y Visual QA:

```bash
npx playwright install chromium
```

## Instalación

### Desde el repositorio

```bash
git clone https://github.com/kerwilgil/arclume.git
cd arclume
npm ci
npm run build
```

La CLI queda disponible como `node dist/cli/index.js` (prueba `node dist/cli/index.js --help`), o linkeada como bin `arclume` con `npm link`.

La publicación del paquete npm está planificada para la release formal ARCLUME 1.0 — todavía no existe un paquete `arclume` publicado en el registro npm.

## Windows

ARCLUME tiene tres vías en Windows, por orden de preferencia.

**1. Instalador (para cualquier persona).** `ARCLUME-Setup-<version>.exe`
instala por usuario, sin permisos de administrador, y crea un acceso directo en
el menú Inicio (y opcionalmente en el escritorio). Al abrir ARCLUME, el
navegador se abre solo.

**2. Portable.** Descomprimir `ARCLUME-<version>-portable.zip` donde sea y
doble clic en `ARCLUME.exe`.

Ambas llevan su propio runtime de Node.js y su propio Chromium: **no hay que
instalar nada más** — ni Node.js, ni npm, ni PowerShell 7, ni
`playwright install`. Las exportaciones (HTML, PDF, PPTX) funcionan sin
conexión.

**3. Checkout del código (para desarrolladores).** Desde un clon de este
repositorio:

```text
double-click install-arclume.cmd     primera instalación
double-click ARCLUME.cmd             uso diario
```

Esa vía sí requiere Node.js >= 20.16.0 y npm en la máquina. Equivalente CLI:

```powershell
node .\dist\cli\index.js web
```

Ver [docs/WINDOWS.md](docs/WINDOWS.md) para el layout de la distribución,
requisitos y solución de problemas.

> **Nota:** el tooling de distribución Windows está listo para la release 1.0.
> Los artefactos (instalador y portable) los produce
> `scripts/windows/build-distribution.ps1`; todavía no están publicados, así
> que hoy no hay nada que descargar desde este repositorio. No están firmados
> digitalmente, por lo que SmartScreen puede advertir en el primer arranque.

## Estado actual

| Área | Estado |
| --- | --- |
| Core (knowledge, deck IR, validación) | Estable |
| CLI | Estable |
| Web UI | Estable |
| Ingesta (PDF / DOCX / URL) | Estable |
| Export (HTML / PDF / PPTX) | Estable |
| Visual QA | Estable |
| Motor Archify | Estable |

**ARCLUME 1.0: release candidate — auditoría final pendiente.** No se ha realizado npm publish, tag git ni GitHub Release.

ARCLUME se llamó anteriormente ProjectDeck (referencia histórica únicamente).

## Documentación

- Arquitectura — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Modelo ProjectKnowledge — [docs/PROJECT_KNOWLEDGE.md](docs/PROJECT_KNOWLEDGE.md)
- IR ArclumeDeck — [docs/IR.md](docs/IR.md)
- Ingesta — [docs/INGESTION.md](docs/INGESTION.md); límites PDF/DOCX/URL y export — [docs/PHASE8.md](docs/PHASE8.md)
- Límite Reasoner y contrato agente — [docs/REASONER.md](docs/REASONER.md), [SKILL.md](SKILL.md)
- Planificación narrativa y de slides — [docs/NARRATIVE.md](docs/NARRATIVE.md), [docs/SLIDE_PLANNING.md](docs/SLIDE_PLANNING.md)
- Dirección visual, temas, modelos visuales — [docs/VISUAL_DIRECTOR.md](docs/VISUAL_DIRECTOR.md), [docs/THEMES.md](docs/THEMES.md), [docs/VISUAL_MODELS.md](docs/VISUAL_MODELS.md)
- Motores de diagrama (Archify) — [docs/DIAGRAM_ENGINES.md](docs/DIAGRAM_ENGINES.md)
- Renderer HTML y viewer — [docs/HTML_RENDERER.md](docs/HTML_RENDERER.md), [docs/VIEWER.md](docs/VIEWER.md)
- Visual QA y entrega atómica — [docs/VISUAL_QA.md](docs/VISUAL_QA.md), [docs/ATOMIC_DELIVERY.md](docs/ATOMIC_DELIVERY.md)
- CLI, presets, watch, packaging — [docs/CLI.md](docs/CLI.md)
- Web UI — [docs/WEB_UI.md](docs/WEB_UI.md)
- Seguridad — [docs/SECURITY.md](docs/SECURITY.md)
- Versionado y estabilidad — [docs/STABILITY.md](docs/STABILITY.md)
- Windows launcher — [docs/WINDOWS.md](docs/WINDOWS.md)

## Licencia

MIT — ver [LICENSE](LICENSE).