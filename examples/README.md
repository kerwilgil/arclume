# Arclume CLI examples

Small, offline examples. `examples/fixtures/sample-repo` is the sample project
used below.

```bash
# 1. directory → executive deck (HTML)
arclume analyze examples/fixtures/sample-repo --out knowledge.json
arclume build knowledge.json --preset executive --format html

# 2. a PDF report → technical deck
arclume analyze ./report.pdf --out report-knowledge.json
arclume build report-knowledge.json --preset technical --format pdf

# 3. a public page → executive deck (secure Phase 8 ingestion, own network)
arclume analyze https://example.com/article --out page-knowledge.json
arclume build page-knowledge.json --preset executive --format pptx

# validate an export bundle afterwards
arclume validate arclume-output/deck.pptx-export
```

PDF export needs Chromium once: `npx playwright install chromium`.
Analyzing never executes the analyzed content. `--json` renders
machine-readable output for agents.
