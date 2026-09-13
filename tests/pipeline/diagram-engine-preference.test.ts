/** Engine preference transform — pure, never mutating. */

import { describe, expect, it } from "vitest";
import { applyDiagramEnginePreference, contentHash } from "../../src/index.js";
import { richDeck } from "../helpers/decks.js";

describe("applyDiagramEnginePreference", () => {
  it("native: every diagram requests the native engine", () => {
    const out = applyDiagramEnginePreference(richDeck(), { preference: "native" });
    for (const d of out.diagrams) expect(d.engine).toBe("native");
  });

  it("visual: only architecture and workflow request the visual engine", () => {
    const out = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    const byId = new Map(out.diagrams.map((d) => [d.id, d.engine]));
    expect(byId.get("dgm-arch")).toBe("visual");
    expect(byId.get("dgm-flow")).toBe("visual");
    expect(byId.get("dgm-seq")).toBe("native");
    expect(byId.get("dgm-tl")).toBe("native");
    expect(byId.get("dgm-rm")).toBe("native");
  });

  it("auto: the supported matrix matches visual", () => {
    const auto = applyDiagramEnginePreference(richDeck(), { preference: "auto" });
    const visual = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    expect(contentHash(auto)).toBe(contentHash(visual));
  });

  it("never mutates the input and never changes anything but diagram.engine", () => {
    const input = richDeck();
    const beforeHash = contentHash(input);
    const out = applyDiagramEnginePreference(input, { preference: "visual" });

    expect(contentHash(input)).toBe(beforeHash); // untouched
    expect(out).not.toBe(input);
    expect(out.diagrams).not.toBe(input.diagrams);
    expect(out.slides).toBe(input.slides);
    expect(out.meta).toBe(input.meta);

    // structural equality apart from the engine field
    for (const [i, d] of input.diagrams.entries()) {
      const o = out.diagrams[i];
      if (o === undefined) throw new Error("missing diagram");
      expect({ ...d, engine: undefined }).toEqual({ ...o, engine: undefined });
    }
  });

  it("is idempotent: applying the same preference twice is a no-op", () => {
    const once = applyDiagramEnginePreference(richDeck(), { preference: "visual" });
    const twice = applyDiagramEnginePreference(once, { preference: "visual" });
    expect(contentHash(once)).toBe(contentHash(twice));
    expect(twice.diagrams).toStrictEqual(once.diagrams);
  });
});
