import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { useData } from '../data.jsx';
import { useDialog } from '../dialogs.jsx';
import { useT } from '../i18n.jsx';
import { fileToPngDataUrl } from '../util.js';
import { AiButton } from './AiAssist.jsx';
import { Field, Modal, PersonaAvatar } from './ui.jsx';

/** Crea (persona = null) o edita una persona. onClose(true) si hubo cambios. */
export default function PersonaEditor({ persona, onClose }) {
  const { t } = useT();
  const { settings, toast } = useData();
  const { confirm } = useDialog();
  const [name, setName] = useState(persona?.name || '');
  const [description, setDescription] = useState(persona?.description || '');
  const [image, setImage] = useState(null);
  const [isDefault, setIsDefault] = useState(persona ? settings.defaultPersona === persona.id : !settings.defaultPersona);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const previewPersona = image ? { id: 'x', name, hasAvatar: false } : { ...persona, name };

  async function pick(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      setImage(await fileToPngDataUrl(f, 256, 256));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function save() {
    setBusy(true);
    try {
      const body = { name, description, image };
      const { id } = persona ? await api.updatePersona(persona.id, body) : await api.createPersona(body);
      if (isDefault && settings.defaultPersona !== id) await api.saveSettings({ defaultPersona: id });
      if (!isDefault && settings.defaultPersona === id) await api.saveSettings({ defaultPersona: '' });
      onClose(true);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: t('personas.editor.delete_title'), message: t('personas.editor.delete_message', { name: persona.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    try {
      await api.deletePersona(persona.id);
      onClose(true);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal
      title={persona ? t('personas.editor.edit_title') : t('personas.editor.new_title')}
      onClose={() => onClose(false)}
      footer={
        <>
          {persona && (
            <button className="btn danger" onClick={remove}>
              {t('common.delete')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn primary" disabled={busy || !name.trim()} onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="inline">
        <button className="avatar-btn" onClick={() => fileRef.current.click()} aria-label={t('personas.editor.change_image')}>
          {image ? <img className="avatar" style={{ width: 72, height: 72 }} src={image} alt="" /> : <PersonaAvatar persona={previewPersona} size={72} />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
        <Field label={t('personas.editor.name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field
        label={t('personas.editor.description')}
        hint={t('personas.editor.description_hint')}
        action={<AiButton field="persona_description" label={t('personas.editor.description_ai')} value={description} onApply={setDescription} context={{ name }} />}
      >
        <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> {t('personas.editor.use_default')}
      </label>
    </Modal>
  );
}
