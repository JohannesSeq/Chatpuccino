import React, { useState } from 'react';
import { api } from '../api.js';
import { useData } from '../data.jsx';
import { useDialog } from '../dialogs.jsx';
import { CharAvatar, Modal } from './ui.jsx';

export default function GroupEditor({ group, onClose, onSaved, onDeleted }) {
  const { characters, refresh, toast } = useData();
  const { confirm } = useDialog();
  const [name, setName] = useState(group?.name || '');
  const [members, setMembers] = useState(group?.members || []);
  const [replyMode, setReplyMode] = useState(group?.replyMode || 'smart');
  const [busy, setBusy] = useState(false);

  const toggle = (id) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  async function save() {
    setBusy(true);
    try {
      const body = { name, members, replyMode };
      const saved = group ? await api.updateGroup(group.id, body) : await api.createGroup(body);
      await refresh('groups');
      onSaved(saved);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: 'Eliminar grupo', message: `Se eliminará el grupo «${group.name}» y todos sus chats. No se puede deshacer.`, confirmLabel: 'Eliminar', danger: true }))) return;
    try {
      await api.deleteGroup(group.id);
      await refresh('groups', 'chats');
      onDeleted?.();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Modal
      title={group ? 'Editar grupo' : 'Nuevo grupo'}
      onClose={onClose}
      footer={
        <>
          {group && (
            <button className="btn danger" onClick={remove}>
              Eliminar
            </button>
          )}
          <span className="spacer" />
          <button className="btn primary" disabled={busy || !name.trim() || members.length < 2} onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Nombre del grupo</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Quién responde</span>
        <select value={replyMode} onChange={(e) => setReplyMode(e.target.value)}>
          <option value="smart">Inteligente: el mencionado, o el siguiente por turnos</option>
          <option value="all">Todos, uno tras otro</option>
          <option value="manual">Manual: yo elijo quién responde</option>
        </select>
      </label>
      <div className="field-label">Miembros ({members.length}) — mínimo 2</div>
      <div className="pick-list">
        {characters.map((c) => (
          <label key={c.id} className="pick-row">
            <input type="checkbox" checked={members.includes(c.id)} onChange={() => toggle(c.id)} />
            <CharAvatar character={c} size={36} />
            <span>{c.name}</span>
          </label>
        ))}
        {!characters.length && <p className="muted">Primero crea o importa personajes en Ajustes.</p>}
      </div>
    </Modal>
  );
}
