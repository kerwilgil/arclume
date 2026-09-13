import { useEffect, useState } from "react";
import { api } from "./api";
import type { WebApiError } from "./api";
import { useI18n } from "./i18n";
import type { ClaimEvidenceItemDto, EvidenceSummaryDto } from "./types";

/**
 * EvidenceInspector — the human-friendly view of why ARCLUME claims what it
 * claims. Proofs are rendered from the /knowledge-evidence endpoint which
 * caches the deterministic verification per workspace.
 */
export function EvidenceInspector(props: { workspaceId: string }): JSX.Element | null {
  const { t } = useI18n();
  const [payload, setPayload] = useState<EvidenceSummaryDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api<EvidenceSummaryDto>("GET", `/api/workspaces/${props.workspaceId}/knowledge-evidence`)
      .then((d) => {
        setPayload(d);
        setError(null);
      })
      .catch((e: WebApiError) => {
        setError(e.message ?? t.errors.unknown);
      })
      .finally(() => setLoading(false));
    // The workspace id is stable; if it changes, fetch again.
  }, [props.workspaceId, t.errors.unknown]);

  if (loading) {
    return (
      <div className="evidence-loading">
        <p className="muted">{t.knowledge.evidenceHeading}…</p>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="error-box" role="alert">
        <strong>{error}</strong>
      </div>
    );
  }

  if (!payload) {
    return null;
  }

  if (payload.claims.length === 0 && payload.risks.length === 0) {
    return (
      <div className="muted small">
        <p>{t.knowledge.noClaimsToInspect}</p>
      </div>
    );
  }

  const claimRows = [...payload.claims, ...payload.risks];

  return (
    <div className="evidence-inspector">
      <div className="subheading">{t.knowledge.evidenceSubtitle}</div>
      {claimRows.map((item) => {
        const { statement, factType, verification, proofs } = item;
        const badge = badgeFor(verification, t);
        const verificationLabel = verificationLabelFor(item.factType, verification, t);
        return (
          <details key={item.id} className="evidence-claim">
            <summary>
              <span className={`badge evidence-${badge}`}>{verificationLabel}</span>
              <span className="evidence-statement">{statement}</span>
              <span className={`badge fact-${factType.toLowerCase()}`}>{factType}</span>
            </summary>
            {proofs.length === 0 ? (
              <p className="muted small">{t.knowledge.noEvidenceForClaim}</p>
            ) : (
              <ul className="evidence-list">
                {proofs.map((p) => (
                  <li key={proofKey(p)}>{proofLine(p, t)}</li>
                ))}
              </ul>
            )}
          </details>
        );
      })}
    </div>
  );
}

function badgeFor(
  verification: ClaimEvidenceItemDto["verification"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (verification === "verified") return "verified";
  if (verification === "unverified") return "unverified";
  return "unavailable";
}

function verificationLabelFor(
  factType: ClaimEvidenceItemDto["factType"],
  verification: ClaimEvidenceItemDto["verification"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (verification === "verified") return t.knowledge.factVerified;
  if (verification === "unavailable") return t.knowledge.factUnavailable;
  // Unverified.
  switch (factType) {
    case "FACT":
      return t.knowledge.evidenceUnverifiedFact;
    case "INFERENCE":
      return t.knowledge.factUnverified;
    case "RECOMMENDATION":
      return t.knowledge.factUnverified;
    case "UNKNOWN":
      return t.knowledge.evidenceUnknownFact;
    default:
      return t.knowledge.factUnverified;
  }
}

function proofKey(p: {
  sourceId: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  quote?: string;
}): string {
  return `${p.sourceId}|${p.path ?? ""}|${String(p.lineStart ?? "")}|${String(p.lineEnd ?? "")}|${p.quote ?? ""}`;
}

function proofLine(
  p: {
    sourceId: string;
    path?: string;
    lineStart?: number;
    lineEnd?: number;
    commit?: string;
    quote?: string;
    verification: "verified" | "unverified" | "unavailable";
    reasonCode?: string;
    detail?: string;
  },
  t: ReturnType<typeof useI18n>["t"],
): JSX.Element {
  const statusClass = `ev proof-${p.verification}`;
  const bits: string[] = [];
  if (p.path !== undefined) bits.push(p.path);
  if (p.lineStart !== undefined) {
    bits.push(
      `lines ${p.lineStart}${p.lineEnd !== undefined && p.lineEnd !== p.lineStart ? `-${p.lineEnd}` : ""}`,
    );
  }
  if (p.commit !== undefined) bits.push(p.commit.slice(0, 10));
  return (
    <>
      <span className={statusClass} title={p.detail ?? p.reasonCode}>
        {statusIcon(p.verification)}
      </span>
      <code>{p.sourceId}</code>
      {bits.length > 0 && <span className="muted small"> {bits.join(" · ")}</span>}
      {p.quote !== undefined && <span className="quote"> “{p.quote}”</span>}
    </>
  );
}

function statusIcon(v: "verified" | "unverified" | "unavailable"): string {
  if (v === "verified") return "✓";
  if (v === "unverified") return "⚠";
  return "—";
}
