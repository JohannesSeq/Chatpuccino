import React, { useState } from 'react';
import { api } from '../../../api.js';
import { useT } from '../../../i18n.jsx';

export default function ConnectionCard({ value, onChange, hasPass, disabled }) {
  const { t } = useT();
  const [test, setTest] = useState(null);

  const runTest = async () => {
    setTest({ running: true });
    try {
      const r = await api.testStudio({ baseUrl: value.baseUrl, user: value.user, pass: value.clearPass ? '' : value.pass });
      setTest({ ok: true, message: r.message || t('studio.settings.connection.test_ok') });
    } catch (e) {
      setTest({ ok: false, message: e.message });
    }
  };

  const passPlaceholder = value.clearPass ? t('studio.settings.connection.pass_cleared') : hasPass ? t('studio.settings.connection.pass_saved') : t('studio.settings.connection.pass_none');

  return (
    <section className="card stack set-card" aria-labelledby="set-conn-title">
      <div>
        <h3 id="set-conn-title">{t('studio.settings.connection.title')}</h3>
        <p className="muted set-lead">{t('studio.settings.connection.intro')}</p>
      </div>
      <label className="field">
        <span className="field-label">{t('studio.settings.connection.url')}</span>
        <input type="url" inputMode="url" autoComplete="off" spellCheck={false} value={value.baseUrl} placeholder="http://127.0.0.1:7860" onChange={(e) => onChange({ baseUrl: e.target.value })} disabled={disabled} />
        <span className="field-hint">{t('studio.settings.connection.url_hint')}</span>
      </label>
      <div className="set-cols">
        <label className="field">
          <span className="field-label">{t('studio.settings.connection.user')}</span>
          <input type="text" autoComplete="off" value={value.user} onChange={(e) => onChange({ user: e.target.value })} disabled={disabled} />
        </label>
        <div className="field">
          <label className="field">
            <span className="field-label">{t('studio.settings.connection.pass')}</span>
            <input type="password" autoComplete="new-password" value={value.pass} placeholder={passPlaceholder} onChange={(e) => onChange({ pass: e.target.value, clearPass: false })} disabled={disabled} />
          </label>
          {hasPass && !value.clearPass && (
            <button type="button" className="btn small set-inline-btn" onClick={() => onChange({ pass: '', clearPass: true })}>
              {t('studio.settings.connection.pass_clear')}
            </button>
          )}
          {value.clearPass && (
            <button type="button" className="btn small set-inline-btn" onClick={() => onChange({ clearPass: false })}>
              {t('studio.settings.connection.pass_keep')}
            </button>
          )}
        </div>
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={runTest} disabled={test?.running || !value.baseUrl.trim()}>
          {test?.running ? t('studio.settings.connection.testing') : t('studio.settings.connection.test')}
        </button>
        <span className="muted set-note">{t('studio.settings.connection.test_unsaved')}</span>
      </div>
      <div role="status" aria-live="polite">
        {test && !test.running && test.ok && <p className="set-result ok">✓ {test.message}</p>}
        {test && !test.running && !test.ok && (
          <div className="set-result bad">
            <p className="err">✗ {test.message}</p>
            <p className="muted">{t('studio.settings.connection.test_hint')}</p>
          </div>
        )}
      </div>
    </section>
  );
}
