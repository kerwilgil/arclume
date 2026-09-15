import { rmSync } from "node:fs";

// TypeScript does not remove outputs for source files that were deleted or
// renamed. Cleaning this ignored build directory prevents stale modules from
// entering the published npm tarball.
rmSync(new URL("../dist", import.meta.url), { force: true, recursive: true });
