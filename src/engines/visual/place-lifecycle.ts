/**
 * Deterministic geometry planner for Visual Engine lifecycle diagrams.
 *
 * Input:  states grouped by `lane` (the reserved `main` rail, optional `event`
 *         lanes for interruptions/recovery, an optional `terminal` band for
 *         outcomes) and directed `transitions`.
 * Output: a `col` per state and a `route` per transition that the vendored
 *         `render-lifecycle.mjs` layout validator accepts, plus a `viewBox`.
 *
 * Pure and deterministic. Ties broken by ascending id. Scope: a primary rail
 * on `main` (≤ 5 columns) with lower-lane interruptions and terminal exits
 * (≤ 3 columns each) — the renderer's band budget. Anything outside that is an
 * explicit `unplaceable` reason, never invalid geometry handed to the renderer.
 */

const MAIN_COLS = 5;
const LOWER_COLS = 3;
const DEFAULT_VIEWBOX: readonly [number, number] = [980, 660];

export type LifecycleRoute =
  | "auto"
  | "straight"
  | "drop"
  | "bottom-channel"
  | "top-channel"
  | "right-channel"
  | "left-channel";

export interface LifecyclePlacementInput {
  laneIds: ReadonlyArray<string>;
  states: ReadonlyArray<{ id: string; lane: string }>;
  transitions: ReadonlyArray<{ id: string; from: string; to: string }>;
}

export interface LifecyclePlacement {
  /** state id → column within its band. */
  cols: ReadonlyMap<string, number>;
  /** transition id → route preset. */
  routes: ReadonlyMap<string, LifecycleRoute>;
  viewBox: readonly [number, number];
}

export type LifecyclePlacementResult =
  | { ok: true; placement: LifecyclePlacement }
  | { ok: false; reason: string };

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `main` | `terminal` | `event` — the three vendored bands. */
function bandOf(laneId: string): "main" | "terminal" | "event" {
  if (laneId === "main") return "main";
  if (laneId === "terminal") return "terminal";
  return "event";
}

export function placeLifecycle(input: LifecyclePlacementInput): LifecyclePlacementResult {
  const { laneIds, states, transitions } = input;
  if (!laneIds.includes("main")) {
    return { ok: false, reason: "a lifecycle needs the reserved `main` lane" };
  }

  const laneOf = new Map<string, string>(states.map((s) => [s.id, s.lane]));

  // Column order within a lane: a stable topological pass over the transitions
  // that stay inside the lane, id-sorted at every tie; leftovers appended by id.
  const perLane = new Map<string, string[]>();
  for (const id of laneIds) perLane.set(id, []);
  for (const s of [...states].sort((a, b) => byId(a.id, b.id))) {
    (perLane.get(s.lane) as string[] | undefined)?.push(s.id);
  }
  if ([...perLane.values()].some((v) => v === undefined)) {
    return { ok: false, reason: "a state references a lane that is not declared" };
  }

  const cols = new Map<string, number>();
  for (const [laneId, ids] of perLane) {
    if (ids.length === 0) continue;
    const width = bandOf(laneId) === "main" ? MAIN_COLS : LOWER_COLS;

    const inLane = new Set(ids);
    const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
    const next = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const t of [...transitions].sort((a, b) => byId(a.id, b.id))) {
      if (inLane.has(t.from) && inLane.has(t.to) && t.from !== t.to) {
        indeg.set(t.to, (indeg.get(t.to) ?? 0) + 1);
        (next.get(t.from) as string[]).push(t.to);
      }
    }
    const ready = ids.filter((id) => (indeg.get(id) ?? 0) === 0).sort(byId);
    const ordered: string[] = [];
    const placed = new Set<string>();
    while (ready.length > 0) {
      const id = ready.shift() as string;
      if (placed.has(id)) continue;
      placed.add(id);
      ordered.push(id);
      for (const m of (next.get(id) as string[]).slice().sort(byId)) {
        indeg.set(m, (indeg.get(m) ?? 1) - 1);
        if ((indeg.get(m) ?? 0) === 0 && !placed.has(m)) ready.push(m);
      }
      ready.sort(byId);
    }
    for (const id of ids) if (!placed.has(id)) ordered.push(id); // cycle leftovers

    if (ordered.length > width) {
      return {
        ok: false,
        reason: `lane "${laneId}" has ${ordered.length} states; its band supports at most ${width} columns`,
      };
    }
    ordered.forEach((id, i) => cols.set(id, i));
  }

  // Routes.
  const routes = new Map<string, LifecycleRoute>();
  for (const t of transitions) {
    const laneA = laneOf.get(t.from);
    const laneB = laneOf.get(t.to);
    if (laneA === undefined || laneB === undefined) {
      return { ok: false, reason: `transition "${t.id}" references an unknown state` };
    }
    const bandA = bandOf(laneA);
    const bandB = bandOf(laneB);
    if (laneA === laneB) {
      const ca = cols.get(t.from) ?? 0;
      const cb = cols.get(t.to) ?? 0;
      routes.set(t.id, cb === ca + 1 ? "straight" : cb > ca + 1 ? "top-channel" : "bottom-channel");
    } else if (bandA === "main" && (bandB === "terminal" || bandB === "event")) {
      routes.set(t.id, "bottom-channel"); // drop off the rail
    } else if (bandA === "event" && bandB === "terminal") {
      routes.set(t.id, "bottom-channel");
    } else if ((bandA === "event" || bandA === "terminal") && bandB === "main") {
      routes.set(t.id, "top-channel"); // recovery back onto the rail
    } else {
      routes.set(t.id, "bottom-channel");
    }
  }

  return { ok: true, placement: { cols, routes, viewBox: DEFAULT_VIEWBOX } };
}
