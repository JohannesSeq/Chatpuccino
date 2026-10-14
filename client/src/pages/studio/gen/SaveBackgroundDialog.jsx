import React, { useState } from 'react';
import { api } from '../../../api.js';
import { Field, Modal } from '../../../components/ui.jsx';
import { useData } from '../../../data.jsx';
import { useT } from '../../../i18n.jsx';
import { backgroundJpegBlob, itemSrc } from './helpers.js';

const defaultName = (text) => {
  const words = String(text ?? '').split(/[\s,]+/).filter(Boolean).slice(0, 5).join(' ');
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 80);
};

/** Diálogo para guardar un fondo generado en la biblioteca de fondos del Modo Novela. */
export default function SaveBackgroundDialog({ item, onClose, onSaved }) {
  const { t } = useT();
  const { refresh } = useData();
  const [name, setName] = useState(() => defaultName(item.label || item.prompt));
  const [description, setDescription] = useState(item.label || item.prompt || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.uploadBackground(await backgroundJpegBlob(item), name.trim(), description.trim());
      await refresh('backgrounds');
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('studio.backgrounds.save.title')}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? t('studio.backgrounds.save.saving') : t('studio.backgrounds.save.save')}
          </button>
        </>
      }
    >
      <div className="sg-bg-preview checker">
        <img src={itemSrc(item)} alt={t('studio.backgrounds.save.preview')} />
      </div>
      <Field label={t('studio.backgrounds.save.name')}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus disabled={busy} />
      </Field>
      <Field label={t('studio.backgrounds.save.description')} hint={t('studio.backgrounds.save.description_hint')}>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
      </Field>
      <p className="field-hint">{t('studio.backgrounds.save.format_hint')}</p>
      {error && <p className="err" role="alert">{error}</p>}
    </Modal>
  );
}
