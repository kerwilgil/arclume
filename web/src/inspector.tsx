import { useI18n } from "./i18n";
import type { KnowledgeClaim, KnowledgeView, SourceRefDto } from "./types";

function FactBadge({ factType }: { factType: string }) {
  const lower = factType.toLowerCase();
  return <span className={`badge fact-${lower}`}>{factType}</span>;
}

function SourceRefs({ refs }: { refs: SourceRefDto[] | undefined }) {
  const { t } = useI18n();
  if (!refs || refs.length === 0)
    return <span className="muted small">{t.knowledge.noEvidence}</span>;
  return (
    <ul className="evidence-list">
      {refs.map((r) => (
        <li key={`${r.sourceId}:${String(JSON.stringify(r.locator ?? null))}:${r.quote ?? ""}`}>
          <code>{r.sourceId}</code>
          {r.locator !== undefined && (
            <span className="muted small"> {String(JSON.stringify(r.locator))}</span>
          )}
          {r.quote !== undefined && <span className="quote"> “{r.quote}”</span>}
        </li>
      ))}
    </ul>
  );
}

function ClaimRow({ claim }: { claim: KnowledgeClaim }) {
  return (
    <li className="claim">
      <FactBadge factType={claim.factType} /> <span>{claim.statement}</span>
      <SourceRefs refs={claim.sourceRefs} />
    </li>
  );
}

export function KnowledgeInspector({ knowledge }: { knowledge: KnowledgeView }) {
  const { t } = useI18n();
  const k = knowledge;
  const claims = k.claims ?? [];
  const relations = k.relations ?? [];
  const gaps = k.gaps ?? [];
  const entities = [
    ...(k.capabilities ?? []),
    ...(k.components ?? []),
    ...(k.actors ?? []),
    ...(k.dependencies ?? []),
    ...(k.processes ?? []),
    ...(k.phases ?? []),
    ...(k.milestones ?? []),
    ...(k.metrics ?? []),
    ...(k.risks ?? []),
    ...(k.constraints ?? []),
  ];

  return (
    <div className="inspector">
      <section className="kv-block" aria-label={t.knowledge.projectHeading}>
        <h3>{t.knowledge.projectHeading}</h3>
        <div className="kv">
          <span className="label">{t.knowledge.nameLabel}</span>
          <strong>{k.project?.name ?? t.knowledge.unnamedProject}</strong>
        </div>
        {k.project?.summary && <p>{k.project.summary}</p>}
        {k.project?.status && (
          <div className="kv">
            <span className="label">{t.knowledge.statusLabel}</span>
            <span>{k.project.status}</span>
          </div>
        )}
        <div className="kv">
          <span className="label">{t.knowledge.knowledgeVersionLabel}</span>
          <code>{k.knowledgeVersion ?? "?"}</code>
        </div>
      </section>

      <section>
        <h3>
          {t.knowledge.entitiesHeading} <span className="muted small">({entities.length})</span>
        </h3>
        {entities.length === 0 ? (
          <p className="muted">{t.knowledge.noEntities}</p>
        ) : (
          <ul className="entity-list">
            {entities.map((e) => (
              <li key={e.id}>
                <code>{e.id}</code> <strong>{e.name}</strong>
                {e.kind && <span className="muted small"> {e.kind}</span>}
                {e.description && <div className="muted small">{e.description}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>
          {t.knowledge.claimsHeading} <span className="muted small">({claims.length})</span>
        </h3>
        {claims.length === 0 ? (
          <p className="muted">{t.knowledge.noClaims}</p>
        ) : (
          <ul className="claim-list">
            {claims.map((c) => (
              <ClaimRow key={c.id} claim={c} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>
          {t.knowledge.relationsHeading} <span className="muted small">({relations.length})</span>
        </h3>
        {relations.length === 0 ? (
          <p className="muted">{t.knowledge.noRelations}</p>
        ) : (
          <ul className="relation-list">
            {relations.map((r) => (
              <li key={r.id}>
                <code>{r.from}</code> —<em>{r.type}</em>→ <code>{r.to}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>
          {t.knowledge.gapsHeading} <span className="muted small">({gaps.length})</span>
        </h3>
        {gaps.length === 0 ? (
          <p className="ok">{t.knowledge.noGaps}</p>
        ) : (
          <ul className="gap-list">
            {gaps.map((g) => (
              <li key={g.id} data-severity={g.severity ?? "low"}>
                <strong>{g.question}</strong>
                {g.why && <div className="muted small">{g.why}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>
          {t.knowledge.sourcesHeading}{" "}
          <span className="muted small">({(k.sources ?? []).length})</span>
        </h3>
        <ul className="source-list">
          {(k.sources ?? []).map((s) => (
            <li key={s.id}>
              <code>{s.id}</code> <span className="muted">{s.kind}</span>{" "}
              {s.title ?? s.uri ?? t.knowledge.untitledSource}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
