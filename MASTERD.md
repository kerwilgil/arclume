# ARCLUME — MASTERD

> Documento maestro del proyecto  
> Actualizado: 2026-09-13  
> Estado: **1.0.0 en cierre de CI / republicación limpia**  
> Repositorio: `kerwilgil/arclume`

---

# 1. Propósito del proyecto

**ARCLUME** transforma proyectos, repositorios y documentos complejos en conocimiento estructurado, narrativas visuales y presentaciones verificables.

Tagline oficial:

> **Arclume turns complex projects into clear visual narratives.**

ARCLUME no es solamente un generador de slides. El producto combina:

```text
Source understanding
+ Evidence-backed ProjectKnowledge
+ AI Reasoning
+ Narrative Planning
+ Slide Planning
+ Visual Intelligence
+ Validation
+ HTML / PDF / editable PPTX
```

El principio central es que el contenido visual debe permanecer trazable a evidencia real.

---

# 2. Arquitectura maestra

```text
INPUT
↓
INGESTION
↓
CONTENT ANALYZER / AI REASONER
↓
AnalysisResult
↓
ProjectKnowledge
↓
NARRATIVE PLANNER
↓
SLIDE PLANNER
↓
VISUAL DIRECTOR
↓
ARCLUME VISUAL INTELLIGENCE
↓
ARCLUME IR
↓
RENDERERS
↓
VALIDATION
↓
EXPORT
```

## Contratos que deben permanecer estables

- `AnalysisResult`
- `ProjectKnowledge`
- `ReasonerRequest → Reasoner → AnalysisResult`
- Narrative Planner
- Slide Planner
- Visual Director
- `ArclumeDeck` / `ArclumeDeckIR`
- canonical rendering pipeline
- provenance chain
- export contracts

## Separación de análisis y build

```text
arclume analyze ./project
→ project-knowledge.json

arclume build project-knowledge.json --audience executive
```

Esto permite reconstruir distintas narrativas sin volver a ejecutar el Reasoner.

---

# 3. Evidence model

Tipos de claim:

```text
FACT
INFERENCE
UNKNOWN
RECOMMENDATION
```

Reglas:

- `FACT` requiere evidencia.
- `INFERENCE` debe distinguirse de hecho confirmado.
- `UNKNOWN` se conserva cuando no existe soporte suficiente.
- `RECOMMENDATION` nunca debe presentarse como hecho.

Cadena de provenance:

```text
source
↓
ProjectKnowledge
↓
VisualDecision
↓
DiagramModel
↓
DiagramArtifact
↓
ArclumeDeck
↓
Export Artifact
```

El Evidence Inspector debe poder explicar el origen de claims relevantes.

---

# 4. Producto 1.0.0

## 4.1 Ingestion

Fuentes objetivo:

- proyectos/repositories locales;
- archivos locales;
- URLs cuando la función lo permita;
- rutas manuales;
- selector nativo Browse / Examinar.

El selector local actual usa:

`POST /api/system/pick-source`

con protección loopback y session token.

## 4.2 Analysis

Modos:

### Fast

```text
Primary Reasoner
↓
AnalysisResult
↓
ARCLUME validation
↓
ProjectKnowledge
```

### Verified

```text
Primary Reasoner
↓
candidate
↓
Reviewer Reasoner
↓
critique / corrections
↓
ARCLUME validation
↓
ProjectKnowledge
```

Un fallo del reviewer no debe degradar silenciosamente a Fast.

## 4.3 AI providers

Soportados:

- `stub`
- `agent`
- `claude-code`
- `codex`
- `anthropic`
- `openai`
- `nvidia`
- `openai-compatible`
- `ollama`

NVIDIA base URL:

`https://integrate.api.nvidia.com/v1`

Model discovery debe evitar depender de nombres manuales cuando el proveedor lo permita.

## 4.4 Knowledge

`ProjectKnowledge` es la fuente semántica de verdad del proyecto.

Debe contener evidencia estructurada suficiente para construir narrativas distintas sin tener que reanalizar el source.

## 4.5 Build

Audience presets 1.0:

- executive
- technical
- product
- client
- investor
- internal-review

Deck types:

- project-overview
- architecture-review
- technical-deep-dive
- executive-brief
- proposal
- status-report
- migration-plan
- product-overview
- incident-postmortem

## 4.6 Visual Intelligence

Familias visuales 1.0:

1. Architecture
2. Workflow / Process
3. Sequence
4. Data Flow
5. Lifecycle
6. Timeline
7. Roadmap

Principios:

- determinismo;
- provenance;
- datos reales antes que decoración;
- fallbacks explícitos;
- no inventar topología;
- no cortar silenciosamente contenido;
- no red externa durante render determinista;
- contenido no confiable tratado como texto.

## 4.7 Export

Formatos:

- HTML
- PDF
- editable PPTX

Todos deben derivar del deck y artifacts visuales validados.

---

# 5. Seguridad y privacidad

ARCLUME 1.0 es local-first.

## Web local

- bind solo a `127.0.0.1`;
- same-origin;
- session protection;
- CSP;
- host allowlist;
- no analytics ARCLUME;
- no ARCLUME cloud account.

## Secrets

Ubicación recomendada Windows:

```text
%LOCALAPPDATA%\ARCLUME\
├── config\providers.json
├── secrets\.env
└── logs\
```

Precedencia:

```text
explicit process environment
↓
user secrets .env
↓
provider config
```

Nunca guardar secrets en:

- repo;
- workspace;
- deck exports;
- localStorage frontend;
- logs;
- receipts;
- frontend API responses.

## Providers remotos

La UI debe informar que un proveedor remoto puede recibir material de análisis.

---

# 6. UX 1.0

Sidebar principal:

```text
1 Source / Fuente
2 Analysis / Análisis
3 Knowledge / Conocimiento
4 Build / Construir
5 Export / Exportar

Help / Ayuda
Settings / Configuración
```

Help y Settings no son etapas numeradas.

## Idiomas

```ts
type Locale = "en" | "es";
```

Persistencia:

`arclume.ui.locale`

## Apariencia

```ts
type Appearance = "system" | "light" | "dark";
```

Persistencia:

`arclume.ui.appearance`

El sidebar debe permanecer completo en páginas largas y zooms 100/125/150%.

---

# 7. Windows distribution

Arquitectura:

```text
ARCLUME.exe
+ bundled Node
+ bundled Chromium
+ ARCLUME app
```

No Electron.

Launcher:

- Go stdlib-first;
- paths relativos a `os.Executable()`;
- HTTP 200 readiness;
- browser default;
- Job Object cleanup;
- `--smoke-test`;
- `--no-browser`;
- logs en `%LOCALAPPDATA%\ARCLUME\logs`;
- error fatal vía MessageBox.

Installer:

- Inno Setup;
- per-user;
- `%LOCALAPPDATA%\Programs\ARCLUME`;
- sin admin/UAC;
- Start Menu;
- desktop opcional;
- uninstall limpio.

Artifacts oficiales previstos:

```text
ARCLUME-Setup-1.0.0.exe
ARCLUME-1.0.0-portable.zip
SHA256SUMS.txt
```

---

# 8. Branding

Primary mark: **Lume Glyph**  
Secondary concept: **Arc Fold**

Paleta:

```text
Graphite     #0B0F14
Deep Navy    #07153E
Lumen Blue   #3B82F6
Accent Blue  #2563EB
Light Blue   #60A5FA
Soft White   #F8FAFC
Cool Gray    #94A3B8
Line Gray    #D7DEE8
```

El Lume Glyph no debe reinterpretarse arbitrariamente.

El paquete de marca final debe conservar:

- SVG
- PNG
- ICO
- banners
- wallpapers
- social assets
- tokens
- `BRAND-GUIDE.md`

---

# 9. Estado actual de 1.0.0

El repositorio GitHub oficial fue eliminado y recreado para iniciar una historia pública limpia.

SHA público actual verificado:

`e8376b9710d9365f46f273c3897671836f42f793`

Commit:

`feat: release ARCLUME 1.0.0`

La base funcional corresponde al estado más reciente del producto previo al reset de historia, incluyendo Browse/Examinar y el fix de sidebar.

## Gate actualmente abierto

`ARCLUME 1.0.0 — FINAL CI CLOSURE`

Estado conocido:

```text
check                  FAIL
check-min-node         FAIL
visual-qa              FAIL
windows-distribution   PASS
```

No existe todavía autorización para tag/release.

### Bloqueadores conocidos

- boundary de labels XSS;
- final SVG validation frente a corpus XSS;
- fixture `.gitignore` / `notes.local.md`;
- expectativas stale en tests;
- saneamiento nominal final;
- eliminación de referencias internas a `1.0.1`.

### Definition of Done para 1.0.0

```text
check                  SUCCESS
check-min-node         SUCCESS
visual-qa              SUCCESS
windows-distribution   SUCCESS

P0 = 0
P1 = 0
```

Después:

```text
annotated v1.0.0
↓
GitHub Release ARCLUME 1.0
↓
new Windows artifacts
↓
SHA256 verification
↓
downloaded-artifact physical smoke
↓
ARCLUME_1_0_REPUBLICATION_PASS
```

---

# 10. Política de referencias externas

En superficies propias de ARCLUME no deben aparecer nombres de proyectos usados únicamente como referencia histórica, visual o conceptual.

Aplica a:

- source paths propios;
- internal identifiers;
- comments/JSDoc;
- error codes;
- test descriptions;
- fixtures propios;
- README;
- Help;
- roadmap;
- release notes;
- UI;
- screenshots;
- metadata propia.

Esto es un **saneamiento nominal**, no autorización para reconstruir código que ya funciona.

Excepción única: avisos/licencias legalmente obligatorios de software de terceros realmente redistribuido. Esos avisos no deben falsificarse ni ocultarse.

---

# 11. Roadmap maestro

## Milestone A — ARCLUME 1.0.0 Final Release

Estado: **EN PROGRESO**

Objetivos restantes:

- cerrar XSS tests correctamente;
- cerrar fixtures/stale expectations;
- CI exact-head 4/4;
- final security/reference scan;
- physical Windows release validation;
- `v1.0.0`;
- GitHub Release;
- post-download smoke.

Salida:

`ARCLUME_1_0_REPUBLICATION_PASS`

---

## Milestone B — 1.0.x macOS Platform Parity

Estado: **PENDIENTE DESPUÉS DE 1.0.0**

Objetivo:

Llevar la arquitectura web-first local de ARCLUME a macOS sin reescribir el producto.

Arquitectura prevista:

```text
ARCLUME.app
↓
bundled Node
↓
backend local
↓
127.0.0.1
↓
default browser
```

Entregables:

- `.app`;
- bundled Node;
- bundled Chromium;
- source picker nativo file/folder;
- data en `~/Library/Application Support/ARCLUME`;
- lifecycle cleanup;
- ZIP/DMG por arquitectura real;
- codesign/notarization truthful;
- full Source → Analysis → Knowledge → Build → Export validation.

Fuera de alcance:

- Electron;
- Tauri;
- Wails;
- WebView rewrite;
- rediseño del frontend.

---

## Milestone C — ARCLUME 1.1: Interactive Visual Intelligence & Change Awareness

Estado: **ROADMAP APROBADO / NO INICIADO**

### Phase 1 — Interactive Diagram Foundation

- zoom;
- pan;
- fit;
- node selection;
- focus;
- search;
- upstream/downstream exploration;
- relation highlighting;
- keyboard accessibility.

### Phase 2 — Visual → Evidence Navigation

- node → source;
- node → evidence;
- node → claims;
- provenance details;
- reverse navigation Evidence → visual.

### Phase 3 — Selective Regeneration

- regenerate slide;
- regenerate diagram;
- regenerate section;
- usar `ProjectKnowledge` existente;
- zero Reasoner calls por defecto.

### Phase 4 — Architecture Delta

Comparar ProjectKnowledge A vs B:

- added nodes;
- removed nodes;
- modified nodes;
- relation deltas;
- risk deltas;
- constraint deltas;
- evidence deltas.

### Phase 5 — Git Change Intelligence

Comparaciones read-only:

- HEAD vs worktree;
- commit A vs B;
- branch vs base;
- changed architecture;
- changed evidence;
- changed risks.

### Phase 6 — Visual Intelligence 2.0

- mejor dataflow layout;
- lifecycle labels;
- dense graph handling;
- relation reason metadata;
- confidence metadata;
- deliberate fallbacks;
- stronger visual QA.

### Phase 7 — Deck Workspace

- outline;
- reorder;
- include/hide;
- duplicate;
- metadata;
- compare narratives.

### Phase 8 — Interactive HTML Export

Offline export con:

- zoom;
- pan;
- search;
- focus;
- upstream/downstream;
- evidence navigation.

PDF/PPTX permanecen estáticos.

### Phase 9 — UX / QA / Release Hardening

- accessibility;
- responsive QA;
- EN/ES;
- themes;
- deterministic regression suite;
- release packaging.

### Fuera de 1.1

- hosted user accounts;
- realtime team collaboration;
- SSO;
- remote sync/storage;
- mobile client;
- AI cost router;
- N-provider consensus;
- plugin marketplace.

---

# 12. Versioning strategy

Estado público objetivo inmediato:

```text
v1.0.0
```

No publicar una `v1.0.1` para los cambios recientes: esas mejoras quedan consolidadas dentro de la nueva 1.0.0.

Después de la 1.0.0:

- `1.0.x` = correcciones y platform parity sin features disruptivas;
- `1.1.0` = Interactive Visual Intelligence & Change Awareness.

---

# 13. Release governance

Un agente nunca puede declarar release-ready solo porque “el código principal funciona”.

Cada gate necesita evidencia.

## Obligatorio antes de release

- exact SHA;
- clean worktree;
- typecheck;
- lint;
- unit;
- build;
- visual QA;
- Windows distribution;
- security tests;
- secret scan;
- reference scan;
- physical smoke;
- GitHub Actions 4/4.

## Prohibido para conseguir verde

- ocultar tests fallidos;
- relajar seguridad;
- sustituir payload XSS por uno benigno;
- `skip` injustificado;
- llamar “problema del entorno” sin demostrarlo;
- crear tag con jobs rojos;
- publicar artifacts no probados.

---

# 14. Orden de trabajo actual

```text
NOW
│
├─ 1. cerrar XSS boundary
├─ 2. cerrar fixture/stale test issues
├─ 3. reference/version scan final
├─ 4. local full gate
├─ 5. push exact SHA
├─ 6. CI 4/4
├─ 7. build 1.0.0 artifacts
├─ 8. physical QA
├─ 9. v1.0.0
├─ 10. Release ARCLUME 1.0
└─ 11. downloaded-artifact smoke

NEXT
│
└─ macOS 1.0.x platform parity

THEN
│
└─ ARCLUME 1.1
   └─ Interactive Visual Intelligence & Change Awareness
```

---

# 15. Reglas para agentes

Toda nueva instrucción debe comenzar:

> **Debes responder SIEMPRE en español.**

Además:

1. Verificar el estado real antes de actuar.
2. No usar documentos históricos como arquitectura canónica si contradicen este MASTERD.
3. No reconstruir módulos funcionales sin autorización explícita.
4. No iniciar 1.1 mientras 1.0.0 no esté cerrado.
5. No mezclar proyectos externos con ARCLUME.
6. No cambiar contratos canónicos sin justificar impacto.
7. No crear releases/tags antes del gate correspondiente.
8. Reportar P0/P1 y limitaciones reales.
9. Conservar seguridad y provenance por encima de conveniencia de tests.
10. Detenerse ante una decisión irreversible no autorizada.

---

# 16. Documentos canónicos

Orden de prioridad:

```text
1. MASTERD.md              → producto, arquitectura y roadmap maestro
2. ARCLUME_LOOP.md         → estado operativo y siguiente gate
3. README.md / README.es   → presentación pública
4. docs/*                  → especificaciones técnicas concretas
5. reportes de agentes     → evidencia temporal, no verdad canónica
```

Cuando haya conflicto entre un loop histórico y este documento, prevalece `MASTERD.md` salvo evidencia técnica nueva confirmada.

---

# END OF MASTERD
