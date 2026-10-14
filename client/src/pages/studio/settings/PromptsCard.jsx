import React from 'react';
import { useDialog } from '../../../dialogs.jsx';
import { useT } from '../../../i18n.jsx';

export default function PromptsCard({ kind, value: p, defaults, onChange, expressionPrompts, defaultExpressionPrompts, onExpressionChange, onExpressionsReset }) {
  const { t } = useT();
  const { confirm } = useDialog();

  const ask = (message) => confirm({ title: t('studio.settings.prompts.reset_title'), message, confirmLabel: t('studio.settings.prompts.reset'), danger: true });

  const resetField = async (field) => {
    if (await ask(t('studio.settings.prompts.reset_field_confirm'))) onChange({ [field]: defaults[field] });
  };
  const resetExpression = (label) => onExpressionChange(label, defaultExpressionPrompts[label] ?? '');
  const resetAll = async () => {
    if (await ask(t('studio.settings.prompts.expr_reset_all_confirm'))) onExpressionsReset();
  };

  const labels = Object.keys(expressionPrompts).sort();
  const edited = labels.filter((l) => expressionPrompts[l] !== (defaultExpressionPrompts[l] ?? ''));

  return (
    <section className="card stack set-card" aria-labelledby="set-prompts-title">
      <div>
        <h3 id="set-prompts-title">{t('studio.settings.prompts.title')}</h3>
        <p className="muted set-lead">{t('studio.settings.prompts.intro', { profile: t(`studio.settings.profile.kinds.${kind}`) })}</p>
        <p className="muted set-note">{t('studio.settings.prompts.format')}</p>
      </div>

      <div className="field">
        <div className="field-head">
          <label htmlFor="set-prompt-base" className="field-label">
            {t('studio.settings.prompts.base')}
          </label>
          <button type="button" className="btn small" onClick={() => resetField('prompt')} disabled={p.prompt === defaults.prompt}>
            {t('studio.settings.prompts.reset')}
          </button>
        </div>
        <textarea id="set-prompt-base" rows={3} value={p.prompt} spellCheck={false} placeholder="masterpiece, best quality" onChange={(e) => onChange({ prompt: e.target.value })} />
        <span className="field-hint">{t('studio.settings.prompts.base_hint')}</span>
      </div>

      <div className="field">
        <div className="field-head">
          <label htmlFor="set-prompt-negative" className="field-label">
            {t('studio.settings.prompts.negative')}
          </label>
          <button type="button" className="btn small" onClick={() => resetField('negative')} disabled={p.negative === defaults.negative}>
            {t('studio.settings.prompts.reset')}
          </button>
        </div>
        <textarea id="set-prompt-negative" rows={3} value={p.negative} spellCheck={false} placeholder="lowres, bad anatomy, blurry" onChange={(e) => onChange({ negative: e.target.value })} />
        <span className="field-hint">{t('studio.settings.prompts.negative_hint')}</span>
      </div>

      {kind === 'expression' && (
        <details className="set-details">
          <summary>
            {t('studio.settings.prompts.expr_title')}
            <span className="muted"> · {t('studio.settings.prompts.expr_edited', { count: edited.length })}</span>
          </summary>
          <p className="muted set-note">{t('studio.settings.prompts.expr_hint')}</p>
          <div className="btn-row">
            <button type="button" className="btn small danger" onClick={resetAll} disabled={!edited.length}>
              {t('studio.settings.prompts.expr_reset_all')}
            </button>
          </div>
          <ul className="set-expr-list">
            {labels.map((label) => {
              const isDefault = expressionPrompts[label] === (defaultExpressionPrompts[label] ?? '');
              return (
                <li key={label} className="set-expr">
                  <div className="field-head">
                    <label htmlFor={`set-expr-${label}`} className="field-label">
                      {label}
                      {!isDefault && <span className="set-badge">{t('studio.settings.prompts.expr_modified')}</span>}
                    </label>
                    <button type="button" className="btn small" onClick={() => resetExpression(label)} disabled={isDefault} aria-label={`${t('studio.settings.prompts.reset')}: ${label}`}>
                      {t('studio.settings.prompts.reset')}
                    </button>
                  </div>
                  <textarea id={`set-expr-${label}`} rows={2} value={expressionPrompts[label]} spellCheck={false} onChange={(e) => onExpressionChange(label, e.target.value)} />
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
