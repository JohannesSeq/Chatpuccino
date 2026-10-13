import React, { useState } from 'react';
import { api } from '../api.js';
import { useData } from '../data.jsx';
import { useDialog } from '../dialogs.jsx';
import { useT } from '../i18n.jsx';
import { CharAvatar, Modal } from './ui.jsx';

export default function GroupEditor({ group, onClose, onSaved, onDeleted }) {
  const { characters, refresh, toast } = useData();
  const { confirm } = useDialog();
  const { t } = useT();
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
    if (!(await confirm({ title: t('groups.delete_title'), message: t('groups.delete_message', { name: group.name }), confirmLabel: t('common.delete'), danger: true }))) return;
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
      title={group ? t('groups.edit_title') : t('groups.new_title')}
      onClose={onClose}
      footer={
        <>
          {group && (
            <button className="btn danger" onClick={remove}>
              {t('common.delete')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn primary" disabled={busy || !name.trim() || members.length < 2} onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">{t('groups.name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-        label">{t('groups.reply_mode.label')}</span>
        <select value={replyMode} onChange={(e) => setReplyMode(e.target.value)}>
                  <option value="smart">{t('groups.reply_mode.smart')}</option>
                  <option value="all">{t('groups.reply_mode.all')}</option>
                  <option value="manual">{t('groups.reply_mode.manual')}</option>
        </select>
      </label>
              <div className="field-label">{t('groups.members', { count: members.length })}</div>
      <div className="pick-list">
        {characters.map((c) => (
          <label key={c.id} className="pick-row">
            <input type="checkbox" checked={members.includes(c.id)} onChange={() => toggle(c.id)} />
            <CharAvatar character={c} size={36} />
            <span>{c.name}</span>
          </label>
        ))}
        {!characters.length && <p className="muted">{t('groups.no_characters')}</p>}
      </div>
    </Modal>
  );
}
