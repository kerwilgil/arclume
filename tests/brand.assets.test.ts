import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

describe("Brand assets — integration validation", () => {
  const brandDir = resolve(ROOT, "docs", "assets", "brand");
  const webBrandDir = resolve(ROOT, "web", "public", "brand");

  describe("docs/assets/brand — canonical brand assets", () => {
    it("directory exists", () => {
      expect(existsSync(brandDir)).toBe(true);
    });

    const requiredFiles = [
      "arclume-symbol.svg",
      "arclume-symbol-white.svg",
      "arclume-symbol-black.svg",
      "arclume-logo-horizontal.svg",
      "arclume-logo-horizontal-dark.svg",
      "arclume-logo-horizontal-light.svg",
      "arclume-wordmark.svg",
      "arclume-wordmark-dark.svg",
      "arclume-wordmark-light.svg",
      "favicon.svg",
      "favicon-16.png",
      "favicon-32.png",
      "arclume.ico",
      "readme-header-dark.svg",
      "readme-header-light.svg",
      "github-social-preview.png",
      "brand-tokens.css",
      "brand-tokens.json",
      "BRAND-GUIDE.md",
      "BRAND.md",
    ];

    for (const file of requiredFiles) {
      it(`contains ${file}`, () => {
        expect(existsSync(resolve(brandDir, file))).toBe(true);
      });
    }
  });

  describe("web/public/brand — runtime brand assets", () => {
    it("directory exists", () => {
      expect(existsSync(webBrandDir)).toBe(true);
    });

    const runtimeFiles = [
      "favicon.svg",
      "favicon-16.png",
      "favicon-32.png",
      "arclume.ico",
      "arclume-symbol.svg",
      "arclume-logo-horizontal.svg",
    ];

    for (const file of runtimeFiles) {
      it(`contains ${file}`, () => {
        expect(existsSync(resolve(webBrandDir, file))).toBe(true);
      });
    }
  });

  describe("SHA-256 integrity — source vs destination", () => {
    const hashMap: Record<string, string> = {
      "arclume-symbol.svg": "cac59762b456c9e1fe615554f9c1528c907bcb63426e9bc0c2aa75d74f2b383f",
      "favicon.svg": "3ba34ad82f8a26eeebca23a8b9ef0c515cbff7c7ebfa6842e61ac6017b6de6fc",
      "arclume.ico": "e9550a497e424c5314791824970f1efc2c81bdc4e294bd05908170619279c431",
    };

    for (const [file, expectedHash] of Object.entries(hashMap)) {
      it(`matches SHA-256 for ${file}`, () => {
        const crypto = require("node:crypto");
        const src =
          resolve(ROOT, "brand", "master", file.includes("favicon") ? "" : "master") || "";
        // Use the canonical source paths
        let sourcePath: string;
        if (file === "favicon.svg") {
          sourcePath = resolve(ROOT, "brand", "favicon", "favicon.svg");
        } else if (file === "arclume.ico") {
          sourcePath = resolve(ROOT, "brand", "app-icon", "ARCLUME.ico");
        } else {
          sourcePath = resolve(ROOT, "brand", "master", file);
        }
        const destPath = resolve(brandDir, file);

        const srcHash = crypto.createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
        const destHash = crypto.createHash("sha256").update(readFileSync(destPath)).digest("hex");

        expect(srcHash).toBe(expectedHash);
        expect(destHash).toBe(expectedHash);
      });
    }
  });

  describe("Web UI index.html — favicon references", () => {
    const indexHtml = readFileSync(resolve(ROOT, "web", "index.html"), "utf8");

    it("references favicon.svg", () => {
      expect(indexHtml).toContain('href="/brand/favicon.svg"');
    });

    it("references favicon-16.png", () => {
      expect(indexHtml).toContain('href="/brand/favicon-16.png"');
    });

    it("references favicon-32.png", () => {
      expect(indexHtml).toContain('href="/brand/favicon-32.png"');
    });

    it("references arclume.ico shortcut icon", () => {
      expect(indexHtml).toContain('href="/brand/arclume.ico"');
    });

    it("no remote asset URLs in favicon links", () => {
      const faviconLinks = indexHtml.match(/<link rel="icon"[^>]*>/g) || [];
      for (const link of faviconLinks) {
        expect(link).not.toMatch(/https?:\/\//);
      }
    });
  });

  describe("App.tsx sidebar — brand mark integration", () => {
    const appTsx = readFileSync(resolve(ROOT, "web", "src", "App.tsx"), "utf8");

    it("references arclume-logo-horizontal.svg", () => {
      expect(appTsx).toContain("/brand/arclume-logo-horizontal.svg");
    });

    it("logo has alt=ARCLUME for accessibility", () => {
      expect(appTsx).toContain('alt="ARCLUME"');
    });

    it("logo is NOT aria-hidden (serves as accessible brand name)", () => {
      expect(appTsx).not.toContain('aria-hidden="true"');
    });

    it("no duplicate visible brand-text element", () => {
      expect(appTsx).not.toContain('className="brand-text"');
    });
  });

  describe("Windows shortcut — official icon", () => {
    const shortcutPs1 = readFileSync(
      resolve(ROOT, "scripts", "windows", "create-shortcut.ps1"),
      "utf8",
    );

    it("uses docs/assets/brand/arclume.ico", () => {
      expect(shortcutPs1).toContain("docs\\assets\\brand\\arclume.ico");
    });

    it("does not use cmd.exe as default icon", () => {
      expect(shortcutPs1).not.toContain('$Shortcut.IconLocation = "cmd.exe,0"');
    });
  });

  describe("README — brand banner", () => {
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");

    it("references readme-header-dark.svg", () => {
      expect(readme).toContain("docs/assets/brand/readme-header-dark.svg");
    });

    it("does not contain placeholder comment about visual identity", () => {
      expect(readme).not.toContain("Marcador de identidad visual");
    });
  });

  describe("Package allowlist — brand-containing directories", () => {
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

    it("files array includes web/dist", () => {
      expect(packageJson.files).toContain("web/dist");
    });

    it("files array includes docs", () => {
      expect(packageJson.files).toContain("docs");
    });
  });
});
