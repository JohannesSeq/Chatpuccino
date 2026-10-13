import React from 'react';
import { getCatalog, useT } from '../i18n.jsx';
import { downloadBlob } from '../util.js';
import { Field } from './ui.jsx';

/** Selector del idioma de la interfaz (preferencia guardada con la apariencia) y exportación del archivo de idioma. */
export default function LanguageSettings({ value, onChange }) {
  const { t, lang, languages } = useT();
  return (
    <section className="card">
      <h3>{t('language.title')}</h3>
      <p className="muted">{t('language.description')}</p>
      <Field label={t('language.label')}>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="auto">{t('language.auto')}</option>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="btn-row">
        <button className="btn small" onClick={() => downloadBlob(`${lang}.json`, `${JSON.stringify(getCatalog(lang), null, 2)}\n`)}>
          {t('language.export')}
        </button>
      </div>
      <p className="muted">{t('language.export_hint')}</p>
    </section>
  );
}
