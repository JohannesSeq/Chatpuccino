import React, { useMemo } from 'react';
import { useT } from '../../../i18n.jsx';
import { ImageCard, ResultGrid } from '../ui.jsx';

/** Resultados agrupados por expresión con sus acciones. */
export default function ResultsView({ order, items, savedIds, busy, canSave, onOpen, onSave, onRegenerate, onDiscard, onSaveFirst, onSaveAllFirst, onClear }) {
  const { t } = useT();
  const groups = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const key = it.label || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    const known = order.filter((l) => map.has(l));
    const rest = [...map.keys()].filter((l) => !order.includes(l));
    return [...known, ...rest].map((label) => ({ label, items: map.get(label) }));
  }, [items, order]);

  if (!groups.length) return <p className="muted">{t('studio.expressions.results.empty')}</p>;
  const pending = groups.filter((g) => !g.items.some((i) => savedIds.has(i.id))).length;

  return (
    <div className="stack">
      <div className="btn-row">
        <button type="button" className="btn primary" disabled={busy || !canSave || !pending} onClick={onSaveAllFirst}>
          {t('studio.expressions.results.save_all_first', { count: pending })}
        </button>
        <button type="button" className="btn danger" disabled={busy} onClick={onClear}>
          {t('studio.expressions.results.clear')}
        </button>
      </div>
      {groups.map((g) => (
        <section key={g.label} className="expr-group" aria-label={g.label}>
          <div className="btn-row expr-group-head">
            <h4 className="grow">
              {g.label} <span className="muted">· {t('studio.expressions.results.count', { count: g.items.length })}</span>
            </h4>
            <button type="button" className="btn small" disabled={busy || !canSave} onClick={() => onSaveFirst(g.label)}>
              {t('studio.expressions.results.save_first')}
            </button>
            <button type="button" className="btn small" disabled={busy} onClick={() => onRegenerate(g.label)}>
              {t('studio.expressions.results.regenerate')}
            </button>
          </div>
          <ResultGrid>
            {g.items.map((it) => {
              const saved = savedIds.has(it.id);
              return (
                <ImageCard key={it.id} item={it} onOpen={() => onOpen(it)} badge={saved ? `✓ ${t('studio.expressions.results.saved')}` : it.seed != null && it.seed >= 0 ? `#${it.seed}` : undefined} selected={saved}>
                  <button type="button" className="btn small primary" disabled={busy || !canSave || saved} onClick={() => onSave(it)}>
                    {saved ? t('studio.expressions.results.saved') : t('studio.expressions.results.save')}
                  </button>
                  <button type="button" className="btn small danger" disabled={busy} onClick={() => onDiscard(it)}>
                    {t('studio.expressions.results.discard')}
                  </button>
                </ImageCard>
              );
            })}
          </ResultGrid>
        </section>
      ))}
    </div>
  );
}
