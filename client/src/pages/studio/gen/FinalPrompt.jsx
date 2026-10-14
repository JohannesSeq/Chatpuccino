import React from 'react';
import { useT } from '../../../i18n.jsx';

/** Prompt final tal y como lo compone el servidor (perfil + personaje + extra). Solo lectura. */
export default function FinalPrompt({ positive, negative }) {
  const { t } = useT();
  return (
    <div className="sg-final">
      <div className="field">
        <span className="field-label">{t('studio.characters.final.title')}</span>
        <textarea rows={3} readOnly value={positive} placeholder={t('studio.characters.final.empty')} aria-label={t('studio.characters.final.title')} />
        <span className="field-hint">{t('studio.characters.final.hint')}</span>
      </div>
      {negative && (
        <details>
          <summary>{t('studio.characters.final.negative')}</summary>
          <textarea rows={3} readOnly value={negative} aria-label={t('studio.characters.final.negative')} />
        </details>
      )}
    </div>
  );
}
