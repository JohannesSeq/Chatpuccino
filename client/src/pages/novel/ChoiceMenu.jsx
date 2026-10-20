import React from 'react';
import { Icon } from '../../components/Icon.jsx';
import { useT } from '../../i18n.jsx';

/**
 * Modo clásico: hasta 3 opciones superpuestas al escenario, encima del cuadro de diálogo.
 * Props: choices (texto[]), loading, error, onPick(texto), onEdit(texto), onRegenerate(), onWrite().
 * Con el teclado, las teclas 1–3 eligen (lo gestiona NovelView).
 */
export default function ChoiceMenu({ choices, loading, error, onPick, onEdit, onRegenerate, onWrite }) {
  const { t } = useT();
  const shown = loading ? [] : choices;
  return (
    <div className="vn-choices" role="group" aria-label={t('novelview.classic.aria')}>
      {loading && (
        <div className="vn-choices-status" role="status" aria-live="polite">
          <div className="typing" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span>{t('novelview.classic.loading')}</span>
        </div>
      )}
      {!loading && error && (
        <div className="vn-choices-status error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {!loading && !error && shown.length === 0 && (
        <div className="vn-choices-status">
          <span>{t('novelview.classic.none')}</span>
        </div>
      )}
      {shown.map((text, i) => (
        <div key={`${i}:${text}`} className="vn-choice-row" style={{ animationDelay: `${i * 70}ms` }}>
          <button type="button" className="vn-choice" onClick={() => onPick(text)}>
            <kbd aria-hidden="true">{i + 1}</kbd>
            <span>{text}</span>
          </button>
          <button type="button" className="vn-choice-edit" onClick={() => onEdit(text)} title={t('novelview.classic.edit')} aria-label={t('novelview.classic.edit_n', { n: i + 1 })}>
            <Icon name="edit" size={18} />
          </button>
        </div>
      ))}
      <div className="vn-choices-tools">
        <button type="button" className="btn small" onClick={onRegenerate} disabled={loading} title={t('novelview.classic.other_hint')}>
          <Icon name="refresh" size={16} /> {loading ? t('novelview.classic.thinking') : error ? t('novelview.classic.retry') : t('novelview.classic.other')}
        </button>
        <button type="button" className="btn small" onClick={onWrite}>
          <Icon name="edit" size={16} /> {t('novelview.classic.write')}
        </button>
      </div>
    </div>
  );
}
