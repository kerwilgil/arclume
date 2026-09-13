/**
 * URL network policy (Phase 8): scheme/identity normalization and address
 * classification, with a robust IPv6 identity parser (no prefix heuristics).
 *
 * Pure: never opens a socket.
 */

import { IngestionError } from "../errors.js";

export const URL_NORMALIZER_VERSION = "0.1.0";

export function failUrl(code: string, message: string): never {
  throw new IngestionError(message, { code, severity: "fatal" });
}

export function normalizeRequestedUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    failUrl("ingestion/url-invalid", `not a valid URL: ${raw.slice(0, 120)}`);
  }
  const u = url as URL;
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    failUrl("ingestion/url-invalid", `unsupported URL scheme "${u.protocol.slice(0, -1)}"`);
  }
  if (u.username !== "" || u.password !== "") {
    failUrl("ingestion/url-invalid", "URL credentials are never accepted");
  }
  u.hash = "";
  return u.href;
}

/* ------------------------------------------------------------------ */
/* IPv4                                                                */
/* ------------------------------------------------------------------ */

const IPV4_BLOCKED: ReadonlyArray<[number, number]> = [
  [0x00000000, 0x000000ff], // 0.0.0.0/8 (this-host)
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT)
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24 (TEST-NET-1)
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 (benchmark)
  [0xc6336400, 0xc633aaff], // 198.51.100.0/24 (TEST-NET-2)
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 (TEST-NET-3)
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 (multicast)
  [0xf0000000, 0xffffffff], // 240.0.0.0/4 (reserved) + broadcast
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

/** Classify IPv4. */
export function isIpv4Blocked(ip: string): boolean {
  const v = ipv4ToInt(ip);
  if (v === null) return false;
  return IPV4_BLOCKED.some(([lo, hi]) => v >= lo && v <= hi);
}

/* ------------------------------------------------------------------ */
/* IPv6 (parser-based, not heuristic)                                  */
/* ------------------------------------------------------------------ */

/**
 * Parse an IPv6 literal into 8 groups. Returns null if malformed. Handles ::,
 * leading/trailing compression, and IPv4-mapped forms (dotted-quad tail).
 */
export function parseIpv6Groups(ip: string): number[] | null {
  const s = ip.trim().split("%")[0] as string; // strip zone id
  if (s.includes(".")) {
    // IPv4-mapped/compat: last 32 bits are the dotted tail. Rewrite as two hex
    // groups and let the real parser handle the "::" compression.
    const idx = s.lastIndexOf(":");
    if (idx < 0) return null;
    const head = s.slice(0, idx);
    const tail = s.slice(idx + 1);
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    const h4 = (v4 >>> 16) & 0xffff;
    const l4 = v4 & 0xffff;
    return parsePureV6(`${head}:${h4.toString(16)}:${l4.toString(16)}`);
  }
  return parsePureV6(s);
}

function parsePureV6(s: string): number[] | null {
  if (s === "") return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ?? "";
  const right = halves[1] ?? "";
  const leftGroups = left === "" ? [] : left.split(":").map(parseHexGroup);
  const rightGroups = right === "" ? [] : right.split(":").map(parseHexGroup);
  if (leftGroups.includes(null) || rightGroups.includes(null)) return null;
  const lGroups = leftGroups as number[];
  const rGroups = rightGroups as number[];
  const total = lGroups.length + rGroups.length;
  if (halves.length === 2) {
    const fill = 8 - total;
    if (fill < 1) return null; // "::" must compress at least one group
    return [...lGroups, ...Array.from({ length: fill }, () => 0), ...rGroups];
  }
  return total === 8 ? lGroups.concat(rGroups) : null;
}

function parseHexGroup(tk: string): number | null {
  if (!/^[0-9a-fA-F]{1,4}$/.test(tk)) return null;
  return Number.parseInt(tk, 16);
}

/**
 * True when the IPv6 address is blocked: loopback, unspecified, unique-local,
 * link-local, multicast, documentation, or an IPv4-mapped address whose mapped
 * IPv4 is itself blocked.
 */
export function isIpv6Blocked(ip: string): boolean {
  if (!ip.includes(":")) return false;
  const g = parseIpv6Groups(ip);
  if (g === null) return true; // unparseable IPv6 is never a safe address

  const allZero = g.every((x) => x === 0);
  const onlyLastOne = g.every((x, i) => (i === 7 ? x === 1 : x === 0));
  if (allZero) return true; // ::
  if (onlyLastOne) return true; // ::1

  const g0 = g[0] as number;
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 (unique local)
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)

  // documentation: 2001:db8::/32
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;

  // IPv4-mapped / compat / translated
  const isV4Mapped = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0xffff;
  const isV4Compat = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
  if (isV4Mapped || isV4Compat) {
    const v4 = ((g[6] as number) << 16) | (g[7] as number);
    const dotted = [(v4 >>> 24) & 0xff, (v4 >>> 16) & 0xff, (v4 >>> 8) & 0xff, v4 & 0xff].join(".");
    return isIpv4Blocked(dotted);
  }
  return false;
}

/**
 * Single boundary: any IP blocked (v4 heuristic complete, v6 via the real
 * parser) rejects the whole host. Mixed public+blocked answers are unsafe.
 */
export function assertAllAddressesAllowed(ips: readonly string[], context: string): void {
  if (ips.length === 0) {
    failUrl("ingestion/url-invalid", `no DNS answers for ${context}`);
  }
  for (const ip of ips) {
    if (ip.includes(":") ? isIpv6Blocked(ip) : isIpv4Blocked(ip)) {
      failUrl(
        "ingestion/url-blocked-address",
        `address ${ip} for ${context} must never be contacted`,
      );
    }
  }
}

/** Convenience for policies/tests: true when the address may be contacted. */
export function isBlockedIp(ip: string): boolean {
  return ip.includes(":") ? isIpv6Blocked(ip) : isIpv4Blocked(ip);
}
