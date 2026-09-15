# ARCLUME — LOOP CANÓNICO LIGERO

> Actualizado: 2026-09-15  
> Proyecto: **ARCLUME**  
> Repositorio oficial: `kerwilgil/arclume`  
> Rama: `main`  
> HEAD público/base conocido: `397dd4ee1a47c501c4a606954ae6d3ff6e6996a5`  
> Estado: **ARCLUME 1.0.0 — cierre técnico final antes de commit/CI/release**  
> Veredicto operativo actual: `ARCLUME_1_0_FINAL_CI_BLOCKED`

---

## 0. Regla operativa

Toda instrucción para Nemotron, Claude, Codex, Kimi u otro agente debe comenzar con:

> **Debes responder SIEMPRE en español.**

Solo se permite inglés cuando sea necesario por sintaxis:

- código;
- comandos;
- rutas;
- identificadores;
- APIs;
- nombres literales de tests;
- logs citados textualmente.

ChatGPT actúa como arquitecto/auditor.

Los reportes de agentes externos deben verificarse contra:

- repositorio real;
- worktree;
- pruebas;
- CI;
- SHA exacto.

No aceptar un `PASS` solamente porque un agente lo declare.

No reabrir bloques cerrados salvo evidencia reproducible.

No crear tag ni release con CI incompleto.

No usar fallback nativo como evidencia de que el Visual Engine real funciona.

---

# 1. Identidad canónica

- Producto: **ARCLUME**
- CLI: `arclume`
- Namespace: `@arclume/*`
- Fuente semántica de verdad: `ProjectKnowledge`
- Deck IR: `ArclumeDeck` / `ArclumeDeckIR`

Tagline oficial:

> **Arclume turns complex projects into clear visual narratives.**

Terminología pública preferida:

- **ARCLUME Visual Intelligence**
- **ARCLUME Visual Engine**
- **ARCLUME visual system**
- **ARCLUME visual artifacts**

No vincular la identidad pública de ARCLUME con proyectos externos usados como referencia histórica, técnica o conceptual.

Las atribuciones legales de terceros deben conservarse únicamente donde sean realmente obligatorias.

---

# 2. Arquitectura canónica

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

Separación fuerte:

```text
arclume analyze ./project
→ project-knowledge.json

arclume build project-knowledge.json --audience executive
```

La IA no genera directamente el deck final.

Claims:

```text
FACT
INFERENCE
UNKNOWN
RECOMMENDATION
```

Todo `FACT` requiere evidencia.

---

# 3. Capacidades 1.0.0 que deben preservarse

## Core

- Ingestion
- Analysis / Reasoners
- `ProjectKnowledge`
- Evidence validation
- Narrative Planner
- Slide Planner
- Visual Director
- `ArclumeDeck`
- Rebuild from Knowledge sin rerun del Reasoner

## Visual

- Architecture
- Workflow / Process
- Sequence
- Data Flow
- Lifecycle
- Timeline
- Roadmap

## Producto

- Evidence Inspector
- Audience presets:
  - executive
  - technical
  - product
  - client
  - investor
  - internal-review
- 9 deck types
- HTML
- PDF
- editable PPTX
- EN / ES
- System / Light / Dark
- Help
- Settings

## AI providers

- stub
- agent
- claude-code
- codex
- anthropic
- openai
- nvidia
- openai-compatible
- ollama

## Windows

- `ARCLUME.exe`
- bundled Node
- bundled Chromium
- loopback `127.0.0.1`
- default browser
- cleanup por Job Object
- installer per-user
- portable
- `--smoke-test`
- `--no-browser`

## Cambios consolidados dentro de la nueva 1.0.0

- Browse / Examinar para fuente local
- `POST /api/system/pick-source`
- selección de archivo y carpeta
- cancelación normal
- protección loopback + session token
- sidebar sticky full-height
- regresiones Help / zoom / EN-ES / Light-Dark
- migración nominal hacia Visual Engine
- correcciones de serializer/XSS
- reconciliación i18n del renderer vendorizado

No debe existir una versión pública ARCLUME `1.0.1` en la nueva historia.

---

# 4. Estrategia de republicación 1.0.0

El objetivo no es publicar una versión nueva `1.0.1`.

El estado funcional más reciente que anteriormente podía asociarse internamente con una versión posterior debe quedar consolidado dentro de:

```text
ARCLUME 1.0.0
```

La nueva historia pública debe permanecer limpia.

No importar:

- tags antiguos;
- SHAs históricos innecesarios;
- changelog de versiones retiradas;
- referencias públicas propias a `1.0.1`.

Después del cierre:

```text
v1.0.0
```

será la primera versión pública válida de esta nueva historia.

---

# 5. Estado Git actual

HEAD/base conocido:

```text
397dd4ee1a47c501c4a606954ae6d3ff6e6996a5
```

Estado conocido:

```text
WORKTREE = DIRTY
FIXES     = NOT COMMITTED
```

Existen cambios no committeados relacionados con:

- Visual Engine migration;
- renderer vendorizado;
- i18n;
- serializer;
- tests;
- referencias nominales;
- documentación;
- otras superficies de migración.

Por tanto:

```text
397dd4e...
```

NO representa todavía el estado final que está siendo probado.

Regla:

No asociar resultados finales de pruebas con ese SHA hasta que:

```text
local gate PASS
↓
review diff
↓
commit
↓
nuevo SHA
↓
worktree clean
```

---

# 6. Estado técnico confirmado

## 6.1 i18n duplicado — RESUELTO

Root cause identificado:

`vendor/archify/renderers/shared/i18n.mjs`

contenía una segunda cola de módulo con:

- `SUPPORTED_LOCALES`
- `DEFAULT_LOCALE`
- helpers
- declaraciones divergentes
- sintaxis inválida

Resultado:

```text
Identifier 'SUPPORTED_LOCALES' has already been declared
```

Fix aplicado:

- eliminada únicamente la cola duplicada;
- preservado el catálogo válido;
- restauradas APIs requeridas por `utils.mjs`;
- preservado el escape correcto.

Estado:

```text
NODE_CHECK      PASS
RENDERER_IMPORT PASS
```

---

# 7. Contrato i18n del renderer — RESUELTO

Se compararon las claves requeridas por el renderer/template con las disponibles.

Resultados:

```text
I18N_REQUIRED_KEYS:     176
I18N_AVAILABLE_KEYS:    410
I18N_MISSING_BEFORE:    123
I18N_MISSING_AFTER:     0
I18N_CONTRACT:          PASS
```

Root cause anterior:

`vendor/archify/assets/template.html`

dependía de claves ausentes del catálogo actual.

Ejemplo:

```text
viewer.preset.identity
```

El catálogo fue reconciliado preservando:

- claves existentes;
- inglés;
- español;
- APIs actuales;
- serializer;
- compatibilidad con renderer.

---

# 8. Serializer XML/HTML — RESUELTO

El helper utilizado por el renderer debe conservar escaping determinista:

```text
&  → &amp;
<  → &lt;
>  → &gt;
"  → &quot;
'  → &#39;
```

No usar sustituciones Unicode visualmente similares.

Ejemplos:

```text
<script>alert(1)</script>
→
&lt;script&gt;alert(1)&lt;/script&gt;
```

```text
A > B
→
A &gt; B
```

```text
Tom & Jerry
→
Tom &amp; Jerry
```

Estado confirmado:

```text
SERIALIZER_FIX:       PASS
SEMANTICS_PRESERVED:  YES
```

---

# 9. Política XSS / contenido no confiable

Los labels son datos, nunca markup.

Pipeline obligatorio:

```text
UNTRUSTED LABEL
↓
ARCLUME boundary
↓
escape/encode as TEXT
↓
Visual Engine
↓
valid SVG
↓
sanitation
↓
final-form validation
↓
inert rendered text
```

Prohibido para cerrar tests:

- cambiar payload hostil por payload benigno;
- eliminar tests;
- `skip`;
- `xfail`;
- permitir `<script>`;
- permitir `<img>` malicioso;
- permitir handlers;
- permitir markup ejecutable;
- debilitar sanitizer;
- debilitar final-form validation;
- sustituir caracteres por Unicode parecido;
- declarar PASS usando fallback cuando el renderer real falló.

---

# 10. Estado XSS actual

Renderer real confirmado:

```text
REAL_RENDERER_EXECUTED: YES
NATIVE_FALLBACK_USED:   NO
```

XSS con renderer real:

```text
visual-qa.visual.xss.test.ts
→ PASS
```

Final-form validation:

```text
16/16 PASS
```

P0 relacionado con:

- renderer;
- i18n;
- serializer;
- XSS;

actualmente:

```text
P0 = 0
```

---

# 11. Único bloqueo inmediato conocido — TEST_STALE

Suite de sanitizer:

```text
26/27 PASS
```

El único fallo confirmado está en:

```text
tests/engines/visual/sanitize.test.ts
```

La expectativa actual exige simultáneamente:

```text
NO contener:
<script
```

y también:

```text
SÍ contener literalmente:
<script>alert(1)</script>
```

Eso es internamente contradictorio.

La salida segura correcta es:

```text
&lt;script&gt;alert(1)&lt;/script&gt;
```

Clasificación confirmada:

```text
TEST_STALE
```

Corrección autorizada:

El test debe validar que:

1. no existe markup ejecutable `<script>`;
2. no existe el payload como elemento ejecutable;
3. sí existe su representación textual escapada/inert;
4. sanitizer permanece intacto;
5. final-form validation permanece intacta;
6. corpus XSS permanece intacto.

No cambiar la implementación para satisfacer el test stale.

---

# 12. Gate inmediato actual

Nombre:

```text
ARCLUME 1.0.0 — FINAL LOCAL CI CLOSURE
```

Orden obligatorio desde el estado actual:

```text
1. corregir únicamente la expectativa TEST_STALE de sanitizer
2. sanitizer tests
3. final-form tests
4. runner tests
5. XSS real renderer
6. Visual QA completo
7. typecheck
8. lint
9. unit completo
10. build
11. npm pack --dry-run
12. security / secret gates existentes
13. reference sanitization
14. confirmar MASTERD.md
15. confirmar ARCLUME_LOOP.md
16. P0 = 0
17. P1 = 0
18. revisar git diff
19. commit
20. worktree clean
21. push
22. CI exact-head 4/4
```

---

# 13. Definition of Done — Local Gate

Solo se permite:

```text
ARCLUME_1_0_LOCAL_GATE_PASS
```

si TODO cumple:

```text
renderer real               PASS
native fallback             NO
i18n contract               PASS
serializer                  PASS
semantics preserved         YES
sanitizer                   PASS
final-form validation       PASS
XSS real renderer           PASS
Visual QA                   PASS
typecheck                   PASS
lint                        PASS
unit                        PASS
build                       PASS
npm pack --dry-run          PASS
security gates              PASS
references owned            0
P0                          0
P1                          0
```

No hacer push si el local gate está rojo.

---

# 14. Gate de referencias

Ejecutar:

```text
rg -n -i "archify" . -g "!node_modules/**" -g "!.git/**"
rg -n -i "1\.0\.1" . -g "!node_modules/**" -g "!.git/**"
```

Clasificar cada coincidencia como:

```text
ARCLUME_OWNED
VENDORED_THIRD_PARTY
LEGAL_REQUIRED
DEPENDENCY_METADATA
FALSE_POSITIVE
```

Superficies consideradas ARCLUME-owned por defecto:

- `src/`
- `tests/`
- `docs/`
- `README*`
- `CHANGELOG*`
- `web/`
- Help
- UI
- screenshots
- metadata propia
- comentarios/JSDoc propios
- fixtures propios

Objetivo:

```text
ARCLUME_OWNED archify = 0
ARCLUME_OWNED 1.0.1  = 0
```

Excepciones legítimas:

- `vendor/archify/*`
- avisos legales obligatorios;
- `THIRD_PARTY_NOTICES.md`;
- metadata real de dependencias;
- falsos positivos como números/coordenadas.

No falsificar ni eliminar atribuciones legales.

---

# 15. Documentos canónicos obligatorios

Deben existir en la raíz:

```text
MASTERD.md
ARCLUME_LOOP.md
```

Orden de prioridad:

```text
1. MASTERD.md
2. ARCLUME_LOOP.md
3. README.md / README.es.md
4. docs/*
5. reportes de agentes
```

`MASTERD.md` contiene:

- producto;
- arquitectura;
- roadmap;
- contratos;
- gobernanza.

`ARCLUME_LOOP.md` contiene:

- estado operativo;
- blockers;
- gate actual;
- siguiente acción.

Los agentes no deben reconstruir estos documentos desde memoria.

Si falta alguno:

```text
STOP
↓
restaurar copia canónica exacta
↓
continuar
```

Este documento es la copia canónica actual de `ARCLUME_LOOP.md`.

---

# 16. Gate Git después del local PASS

Después de:

```text
ARCLUME_1_0_LOCAL_GATE_PASS
```

revisar:

```bash
git diff
git status
```

Confirmar:

- no existen cambios accidentales;
- no se descartó trabajo válido;
- no quedan archivos temporales;
- no quedaron payloads/debugging accidentales;
- no quedan referencias owned prohibidas.

Crear commit consolidado de ARCLUME 1.0.0.

Después:

```bash
git status
git rev-parse HEAD
```

Objetivo:

```text
WORKTREE = CLEAN
```

Registrar:

```text
HEAD_FINAL=<nuevo SHA>
```

---

# 17. Push y CI exact-head

Después del local gate y commit:

```text
push main
```

Verificar:

```bash
git rev-parse HEAD
git rev-parse origin/main
```

Deben ser idénticos.

CI obligatorio sobre ESE SHA:

```text
check                  SUCCESS
check-min-node         SUCCESS
visual-qa              SUCCESS
windows-distribution   SUCCESS
```

No aceptar:

- CI de SHA anterior;
- CI parcial;
- jobs skipped no justificados;
- reruns de código diferente;
- fallback local como sustituto de CI.

Solo entonces:

```text
ARCLUME_1_0_FINAL_CI_PASS
```

---

# 18. Gate de release 1.0.0

Después de:

```text
ARCLUME_1_0_FINAL_CI_PASS
```

seguir:

```text
main exact HEAD
↓
full local regression
↓
Windows installer build
↓
portable build
↓
physical smoke
↓
annotated tag v1.0.0
↓
GitHub Release "ARCLUME 1.0"
├── ARCLUME-Setup-1.0.0.exe
├── ARCLUME-1.0.0-portable.zip
└── SHA256SUMS.txt
↓
download artifacts from GitHub
↓
verify SHA256
↓
physical smoke from downloaded artifacts
```

Final verdict:

```text
ARCLUME_1_0_REPUBLICATION_PASS
```

No crear:

```text
v1.0.1
```

---

# 19. Política de artifacts

Artifacts oficiales:

```text
ARCLUME-Setup-1.0.0.exe
ARCLUME-1.0.0-portable.zip
SHA256SUMS.txt
```

Validar:

- nombres correctos;
- versión `1.0.0`;
- ausencia de referencias públicas `1.0.1`;
- ejecutable funcional;
- portable funcional;
- hashes correctos;
- artifacts descargados iguales a los publicados;
- smoke realizado sobre descarga real, no solo build local.

---

# 20. Windows physical smoke

Validar desde artifacts finales:

```text
ARCLUME.exe
↓
bundled Node
↓
backend local
↓
127.0.0.1
↓
default browser
```

Comprobar:

- inicio;
- readiness HTTP 200;
- Source;
- Analysis;
- Knowledge;
- Build;
- Export;
- HTML;
- PDF;
- PPTX editable;
- Help;
- Settings;
- EN/ES;
- Light/Dark/System;
- Browse file;
- Browse folder;
- cancelación;
- cleanup;
- `--smoke-test`;
- `--no-browser`.

No declarar release final sin physical smoke.

---

# 21. Estado de problemas actual

## P0

Estado conocido:

```text
P0 = 0
```

para:

- i18n;
- renderer import;
- renderer real;
- serializer;
- XSS;
- final-form.

Puede volver a `P0 > 0` si el full gate descubre un defecto reproducible nuevo.

## P1

Estado conocido inmediato:

```text
P1 = 1
```

Motivo:

```text
TEST_STALE
tests/engines/visual/sanitize.test.ts
```

Además deben cerrarse antes del local gate:

- referencias ARCLUME-owned a `archify`;
- referencias ARCLUME-owned a `1.0.1`;
- cualquier fallo adicional del full unit/Visual QA.

---

# 22. Clasificación obligatoria de fallos

Todo fallo debe clasificarse exclusivamente como uno de:

```text
TEST_STALE
FIXTURE_MISSING
REAL_CODE_DEFECT
PLATFORM_SPECIFIC
TEST_INFRASTRUCTURE
```

No usar:

```text
"pre-existing"
"environment issue"
"Windows issue"
"flaky"
```

sin evidencia concreta.

Para cada fallo:

```text
TESTS:
ERROR_SIGNATURE:
ROOT_CAUSE:
EVIDENCE:
CLASSIFICATION:
BLOCKING:
```

---

# 23. Reglas estrictas para agentes

Toda instrucción debe comenzar:

> **Debes responder SIEMPRE en español.**

Además:

1. Verificar estado real antes de actuar.
2. Leer `MASTERD.md`.
3. Leer `ARCLUME_LOOP.md`.
4. No usar loops históricos si contradicen documentos canónicos.
5. No reconstruir módulos funcionales sin necesidad.
6. No iniciar 1.1 antes de cerrar 1.0.0.
7. No mezclar proyectos externos con ARCLUME.
8. No cambiar contratos canónicos sin justificar impacto.
9. No crear release/tag antes del gate.
10. Reportar P0/P1.
11. Conservar seguridad y provenance por encima de conveniencia de tests.
12. Detenerse ante decisiones irreversibles no autorizadas.
13. No resetear worktree con cambios existentes sin autorización.
14. No usar fallback como evidencia de renderer real.
15. No ocultar tests fallidos.
16. No debilitar seguridad.
17. No crear `1.0.1`.
18. No declarar CI PASS sin exact-head 4/4.

---

# 24. Roadmap después de 1.0.0

No iniciar hasta:

```text
ARCLUME_1_0_REPUBLICATION_PASS
```

## 1.0.x — Platform parity

Prioridad:

- macOS parity
- `ARCLUME.app`
- bundled Node
- bundled Chromium
- loopback architecture
- native file/folder picker
- DMG / ZIP
- lifecycle cleanup
- full Source → Analysis → Knowledge → Build → Export

No hacer rewrite nativo de UI.

---

# 25. ARCLUME 1.1 — Interactive Visual Intelligence & Change Awareness

Orden previsto:

1. Interactive Diagram Foundation
2. Visual → Evidence Navigation
3. Selective Regeneration
4. Architecture Delta
5. Git Change Intelligence
6. Visual Intelligence 2.0
7. Deck Workspace
8. Interactive HTML Export
9. UX / QA / Release Hardening

Fuera de 1.1:

- hosted accounts
- realtime team collaboration
- SSO
- remote sync/storage
- mobile
- AI cost router
- N-provider consensus
- plugin marketplace

---

# 26. Próxima acción exacta

La siguiente tarea NO es release.

La siguiente tarea es:

```text
1. corregir tests/engines/visual/sanitize.test.ts
   únicamente en su expectativa stale

2. ejecutar:
   sanitizer
   final-form
   runner
   XSS real renderer

3. ejecutar Visual QA completo

4. ejecutar:
   npm ci
   typecheck
   lint
   unit
   build
   npm pack --dry-run

5. ejecutar security/reference gates

6. limpiar:
   ARCLUME-owned "archify"
   ARCLUME-owned "1.0.1"

7. exigir:
   P0 = 0
   P1 = 0

8. declarar únicamente:
   ARCLUME_1_0_LOCAL_GATE_PASS

9. revisar diff

10. commit

11. push

12. GitHub CI exact-head 4/4

13. declarar:
   ARCLUME_1_0_FINAL_CI_PASS
```

Después:

```text
artifacts
→ physical smoke
→ annotated v1.0.0
→ GitHub Release ARCLUME 1.0
→ download artifacts
→ SHA256
→ final physical smoke
→ ARCLUME_1_0_REPUBLICATION_PASS
```

---

# 27. Estado resumido actual

```text
HEAD BASE
397dd4ee1a47c501c4a606954ae6d3ff6e6996a5

WORKTREE
DIRTY / NOT COMMITTED

I18N SYNTAX
PASS

I18N CONTRACT
176 required
410 available
0 missing

RENDERER IMPORT
PASS

REAL RENDERER
YES

NATIVE FALLBACK
NO en validación directa

SERIALIZER
PASS

SEMANTICS
PRESERVED

XSS REAL RENDERER
PASS

FINAL FORM
16/16 PASS

SANITIZER
26/27
1 TEST_STALE confirmado

VISUAL QA FULL
PENDING

TYPECHECK
PENDING FINAL GATE

LINT
PENDING FINAL GATE

UNIT FULL
PENDING AFTER TEST_STALE FIX

BUILD
PENDING FINAL GATE

NPM PACK
PENDING

REFERENCE SANITIZATION
PENDING

P0
0

P1
1

COMMIT
NONE

CI EXACT HEAD
NOT RUN

TAG
NOT AUTHORIZED

RELEASE
NOT AUTHORIZED
```

---

# 28. Veredicto operativo

Estado actual:

```text
ARCLUME_1_0_FINAL_CI_BLOCKED
```

Bloqueador inmediato:

```text
TEST_STALE
tests/engines/visual/sanitize.test.ts
```

Siguiente veredicto esperado:

```text
ARCLUME_1_0_LOCAL_GATE_PASS
```

Después:

```text
ARCLUME_1_0_FINAL_CI_PASS
```

Y finalmente:

```text
ARCLUME_1_0_REPUBLICATION_PASS
```

---

# END OF LOOP
