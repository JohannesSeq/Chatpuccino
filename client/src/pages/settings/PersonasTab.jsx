import React, { useRef, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { fileToPngDataUrl } from '../../util.js';
import { Icon } from '../../components/Icon.jsx';
import { Field, Modal, PersonaAvatar } from '../../components/ui.jsx';

export default function PersonasTab() {
  const { personas, settings, refresh } = useData();
  const [editing, setEditing] = useState(null);

  return (
    <div className="stack">
      <p className="muted">Una persona es tu representación en el roleplay: su nombre reemplaza a {'{{user}}'} y su descripción se envía al modelo.</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> Nueva persona
        </button>
      </div>
      <ul className="rows">
        {personas.map((p) => (
          <li key={p.id} className="row">
            <button className="row-main" onClick={() => setEditing(p)}>
              <PersonaAvatar persona={p} />
              <div className="row-text">
                <strong>
                  {p.name} {settings.defaultPersona === p.id && <span className="tag">predeterminada</span>}
                </strong>
                <div className="row-sub">{p.description || 'Sin descripción'}</div>
              </div>
            </button>
          </li>
        ))}
        {!personas.length && <li className="empty small">Aún no hay personas. Sin ninguna, te llamarán «Usuario».</li>}
      </ul>
      {editing && (
        <PersonaEditor
          persona={editing === 'new' ? null : editing}
          onClose={async (changed) => {
            setEditing(null);
            if (changed) await refresh('personas', 'settings');
          }}
        />
      )}
    </div>
  );
}

function PersonaEditor({ persona, onClose }) {
  const { settings, toast } = useData();
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
    if (!window.confirm(`¿Eliminar la persona "${persona.name}"?`)) return;
    try {
      await api.deletePersona(persona.id);
      onClose(true);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal
      title={persona ? 'Editar persona' : 'Nueva persona'}
      onClose={() => onClose(false)}
      footer={
        <>
          {persona && (
            <button className="btn danger" onClick={remove}>
              Eliminar
            </button>
          )}
          <span className="spacer" />
          <button className="btn primary" disabled={busy || !name.trim()} onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <div className="inline">
        <button className="avatar-btn" onClick={() => fileRef.current.click()} aria-label="Cambiar imagen">
          {image ? <img className="avatar" style={{ width: 72, height: 72 }} src={image} alt="" /> : <PersonaAvatar persona={previewPersona} size={72} />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
        <Field label="Nombre">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field label="Descripción" hint="Cómo eres en la historia (apariencia, personalidad, trasfondo).">
        <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Usar por defecto en chats nuevos
      </label>
    </Modal>
  );
}
