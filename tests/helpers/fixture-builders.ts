/**
 * Minimal fixture builders for Phase 8 ingestion tests. Everything is built
 * from raw bytes in-memory — no network, no committed binary blobs.
 */

import { strToU8, zipSync } from "fflate";

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

/** A minimal multi-page PDF with a real text layer (one string per line). */
export function buildTextPdf(pages: string[][]): Buffer {
  // page i lines: the entries of pages[i]
  // stream per page: BT /F1 12 Tf 72 y Td (line) Tj ET …
  const objects: string[] = [];
  // 1: catalog, 2: pages, 3: font, then per page: N page obj + N content
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids: string[] = [];
  const contents: string[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    const pageObj = 4 + i * 2;
    const contentObj = pageObj + 1;
    kids.push(`${pageObj} 0 R`);
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`;
    let y = 750;
    const ops: string[] = ["BT"];
    for (const line of pages[i] ?? []) {
      ops.push(`/F1 12 Tf 1 0 0 1 72 ${y} Tm (${escapePdfString(line)}) Tj`);
      y -= 20;
    }
    ops.push("ET");
    const stream = ops.join("\n");
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function escapePdfString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** A PDF whose pages carry no text (image-only / blank). */
export function buildImageOnlyPdf(pages: number): Buffer {
  return buildTextPdf(Array.from({ length: pages }, () => []));
}

/**
 * A one-page PDF whose content stream is ONLY save/restore + marked-content
 * operators (q / BMC / BDC / EMC / Q) — bookkeeping with zero visible paint.
 * Used to prove `export/blank-page` fires despite marked-content presence.
 */
export function buildMarkedContentOnlyPdf(): Buffer {
  const stream = "q\n/Span BMC\n/Span << /ActualText (x) >> BDC\nEMC\nEMC\nQ";
  const objects: Record<number, string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
    4: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  };
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i <= 4; i += 1) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += "xref\n0 5\n";
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= 4; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/* ------------------------------------------------------------------ */
/* DOCX                                                                */
/* ------------------------------------------------------------------ */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

export interface DocxSpecParagraph {
  text: string;
  headingDepth?: number; // 1..6 → w:pStyle Heading{n}
  bullet?: boolean; // wrapped in list numbering (simplified: <w:numPr/> marker)
}

/** Build a minimally valid DOCX package with the given paragraphs. */
export function buildDocx(paragraphs: DocxSpecParagraph[]): Buffer {
  const body = paragraphs
    .map((p) => {
      const style = p.headingDepth
        ? `<w:pPr><w:pStyle w:val="Heading${p.headingDepth}"/></w:pPr>`
        : p.bullet
          ? "<w:pPr><w:numPr/></w:pPr>"
          : "";
      const runs = `<w:r><w:t xml:space="preserve">${escapeXml(p.text)}</w:t></w:r>`;
      return `<w:p>${style}${runs}</w:p>`;
    })
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(ROOT_RELS),
    "word/document.xml": strToU8(document),
    "word/styles.xml": strToU8(
      '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    ),
    "word/_rels/document.xml.rels": strToU8(DOC_RELS),
  };
  return Buffer.from(zipSync(files));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A DOCX-shaped zip with a hostile or invalid part list. */
export function buildDocxRaw(files: Record<string, string>): Buffer {
  const mapped: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) mapped[k] = strToU8(v);
  return Buffer.from(zipSync(mapped));
}
