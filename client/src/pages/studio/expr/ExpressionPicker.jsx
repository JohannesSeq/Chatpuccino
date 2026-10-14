import React from 'react';
import { useT } from '../../../i18n.jsx';

/** Rejilla de expresiones a generar: casilla + prompt editable (solo para esta tanda hasta «guardar como predeterminado»). */
export default function ExpressionPicker({ labels, selected, existing, saved, edits, onToggle, onSelect, onEdit, onSaveDefault, extra, onExtra }) {
  const { t } = useT();
  const missing = labels.filter((l) => !existing[l.label]);
  return (
    <div className="stack">
      <div className="btn-row">
        <button type="button" className="btn small" onClick={() => onSelect(missing.map((l) => l.label))} disabled={!missing.length}>
          {t('studio.expressions.pick.missing', { count: missing.length })}
        </button>
        <button type="button" className="btn small" onClick={() => onSelect(labels.map((l) => l.label))}>
          {t('studio.expressions.pick.all')}
        </button>
        <button type="button" className="btn small" onClick={() => onSelect([])} disabled={!selected.size}>
          {t('studio.expressions.pick.none')}
        </button>
        <span className="muted grow expr-count">{t('studio.expressions.pick.selected', { count: selected.size })}</span>
      </div>

      <label className="field">
        <span className="field-label">{t('studio.expressions.pick.extra')}</span>
        <input value={extra} onChange={(e) => onExtra(e.target.value)} placeholder={t('studio.expressions.pick.extra_placeholder')} />
        <span className="field-hint">{t('studio.expressions.pick.extra_hint')}</span>
      </label>

      <div className="expr-grid">
        {labels.map(({ label, kind }) => {
          const n = existing[label] || 0;
          const text = edits[label] ?? saved[label] ?? '';
          const edited = edits[label] !== undefined && edits[label] !== (saved[label] ?? '');
          return (
            <div key={label} className={`expr-cell ${selected.has(label) ? 'on' : ''}`}>
              <label className="expr-check expr-cell-head">
                <input type="checkbox" checked={selected.has(label)} onChange={() => onToggle(label)} />
                <span className="grow">{label}</span>
                {kind === 'custom' && <span className="tag">{t('studio.expressions.pick.custom')}</span>}
                {n > 0 && (
                  <span className="tag expr-done" title={t('studio.expressions.pick.have', { count: n })}>
                    {t('studio.expressions.pick.have_short', { count: n })}
                  </span>
                )}
              </label>
              <details>
                <summary>{edited ? t('studio.expressions.pick.prompt_edited') : t('studio.expressions.pick.prompt')}</summary>
                <textarea
                  rows={3}
                  value={text}
                  aria-label={t('studio.expressions.pick.prompt_aria', { label })}
                  placeholder={t('studio.expressions.pick.prompt_empty', { label })}
                  onChange={(e) => onEdit(label, e.target.value)}
                />
                <div className="btn-row">
                  <button type="button" className="btn small" disabled={!edited} onClick={() => onSaveDefault(label, text)}>
                    {t('studio.expressions.pick.save_default')}
                  </button>
                  <button type="button" className="btn small" disabled={!edited} onClick={() => onEdit(label, undefined)}>
                    {t('studio.expressions.pick.revert')}
                  </button>
                </div>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
