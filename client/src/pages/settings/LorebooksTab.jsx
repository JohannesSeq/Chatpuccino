import React, { useRef, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { downloadBlob } from '../../util.js';
import { Icon } from '../../components/Icon.jsx';
import { Field, Menu, Modal, SearchBox } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';

export default function LorebooksTab() {
  const { t } = useT();
  const { lorebooks, settings, refresh, toast } = useData();
  const { confirm, prompt } = useDialog();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef(null);

  const taken = (v, except) => lorebooks.some((b) => b.name.toLowerCase() === v.toLowerCase() && b.name !== except);

  async function toggleActive(name) {
    const active = settings.activeLorebooks.includes(name) ? settings.activeLorebooks.filter((n) => n !== name) : [...settings.activeLorebooks, name];
    await api.saveSettings({ activeLorebooks: active });
    await refresh('settings');
  }

  async function rename(name) {
    const next = await prompt({
      title: t('lorebooks.rename_dialog.title'),
      label: t('lorebooks.rename_dialog.label'),
      defaultValue: name,
      confirmLabel: t('common.rename'),
      validate: (v) => (taken(v, name) ? t('lorebooks.name_taken') : ''),
    });
    if (!next || next === name) return;
    try {
      await api.renameLorebook(name, next);
      await refresh('lorebooks', 'settings');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function duplicate(name) {
    try {
      const book = await api.lorebook(name);
      await api.createLorebook(t('lorebooks.copy_name', { name }), book);
      await refresh('lorebooks');
      toast(t('lorebooks.duplicated'));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function exportBook(name) {
    try {
      downloadBlob(`${name}.json`, JSON.stringify(await api.lorebook(name), null, 2));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function remove(name) {
    const ok = await confirm({ title: t('lorebooks.delete_dialog.title'), message: t('lorebooks.delete_dialog.message', { name }), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return;
    try {
      await api.deleteLorebook(name);
      await refresh('lorebooks', 'settings');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function onImport(e) {
    const files = [...e.target.files];
    e.target.value = '';
    for (const f of files) {
      try {
        const book = JSON.parse(await f.text());
        await api.createLorebook(book.name || f.name.replace(/\.json$/i, ''), book);
      } catch (err) {
        toast(`${f.name}: ${err.message}`, 'error');
      }
    }
    await refresh('lorebooks');
  }

  if (editing) {
    return (
      <BookEditor
        name={editing}
        onClose={async () => {
          setEditing(null);
          await refresh('lorebooks', 'settings');
        }}
      />
    );
  }

  return (
    <div className="stack">
      <p className="muted">{t('lorebooks.intro')}</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} /> {t('lorebooks.new')}
        </button>
        <button className="btn" onClick={() => fileRef.current.click()}>
          {t('lorebooks.import_json')}
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden onChange={onImport} />
      </div>
      <ul className="rows">
        {lorebooks.map((b) => (
          <li key={b.name} className="row">
            <button className="row-main" onClick={() => setEditing(b.name)}>
              <div className="row-text">
                <strong>{b.name}</strong>
                <div className="row-sub">
                  {t('lorebooks.entry_count', { count: b.entryCount })}
                  {b.description ? ` · ${b.description}` : ''}
                </div>
              </div>
            </button>
            <label className="switch" title={t('lorebooks.global_title')}>
              <input type="checkbox" checked={settings.activeLorebooks.includes(b.name)} onChange={() => toggleActive(b.name)} />
              <span>{t('lorebooks.global')}</span>
            </label>
            <Menu
              items={[
                { label: t('common.edit'), onClick: () => setEditing(b.name) },
                { label: t('common.rename'), onClick: () => rename(b.name) },
                { label: t('common.duplicate'), onClick: () => duplicate(b.name) },
                { label: t('lorebooks.export_json'), onClick: () => exportBook(b.name) },
                { label: t('common.delete'), danger: true, onClick: () => remove(b.name) },
              ]}
            />
          </li>
        ))}
        {!lorebooks.length && <li className="empty small">{t('lorebooks.empty')}</li>}
      </ul>
      <GlobalLoreSettings settings={settings} onSaved={() => refresh('settings')} toast={toast} />
      {creating && (
        <NewLorebookDialog
          taken={(v) => taken(v)}
          onClose={() => setCreating(false)}
          onCreated={async (name) => {
            setCreating(false);
            await refresh('lorebooks');
            setEditing(name);
          }}
        />
      )}
    </div>
  );
}

function NewLorebookDialog({ taken, onClose, onCreated }) {
  const { t } = useT();
  const { toast } = useData();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const error = trimmed && taken(trimmed) ? t('lorebooks.name_taken') : '';

  async function submit(e) {
    e.preventDefault();
    if (!trimmed || error || busy) return;
    setBusy(true);
    try {
      const { name: final } = await api.createLorebook(trimmed, { description: description.trim(), entries: {} });
      onCreated(final);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('lorebooks.new')}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!trimmed || Boolean(error) || busy} onClick={submit}>
            {t('lorebooks.new_dialog.create_edit')}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label={t('lorebooks.new_dialog.name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('lorebooks.new_dialog.name_placeholder')} autoFocus autoComplete="off" />
          {error && <span className="field-error">{error}</span>}
        </Field>
        <Field label={t('lorebooks.new_dialog.description')} hint={t('lorebooks.new_dialog.description_hint')}>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function GlobalLoreSettings({ settings, onSaved, toast }) {
  const { t } = useT();
  const [scanDepth, setScanDepth] = useState(settings.scanDepth);
  const [loreBudget, setLoreBudget] = useState(settings.loreBudget);
  async function save() {
    try {
      await api.saveSettings({ scanDepth, loreBudget });
      toast(t('lorebooks.activation.saved'));
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  return (
    <section className="card">
      <h3>{t('lorebooks.activation.title')}</h3>
      <div className="grid-2">
        <Field label={t('lorebooks.activation.scan_depth')}>
          <input type="number" min={1} value={scanDepth} onChange={(e) => setScanDepth(e.target.value)} />
        </Field>
        <Field label={t('lorebooks.activation.budget')}>
          <input type="number" min={0} step={128} value={loreBudget} onChange={(e) => setLoreBudget(e.target.value)} />
        </Field>
      </div>
      <button className="btn" onClick={save}>
        {t('common.save')}
      </button>
    </section>
  );
}

const POSITIONS = [
  [0, 'before_char'],
  [1, 'after_char'],
  [4, 'at_depth'],
];

function KeysInput({ value, onChange, placeholder }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean));
      }}
    />
  );
}

function BookEditor({ name, onClose }) {
  const { t } = useT();
  const { toast } = useData();
  const { confirm } = useDialog();
  const [book, setBook] = useState(null);
  const [saved, setSaved] = useState('');
  const [title, setTitle] = useState(name);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    api.lorebook(name).then((b) => {
      setBook(b);
      setSaved(JSON.stringify(b));
    }).catch((e) => {
      toast(e.message, 'error');
      onClose();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  if (!book) return <p className="muted">{t('common.loading')}</p>;
  const entries = Object.values(book.entries).sort((a, b) => a.uid - b.uid);
  const dirty = JSON.stringify(book) !== saved || title.trim() !== name;
  const q = filter.trim().toLowerCase();
  const visible = q ? entries.filter((e) => [e.comment, e.content, ...e.key, ...e.keysecondary].some((s) => String(s).toLowerCase().includes(q))) : entries;

  async function goBack() {
    if (dirty && !(await confirm({ title: t('lorebooks.editor.unsaved'), message: t('lorebooks.editor.unsaved_message'), confirmLabel: t('lorebooks.editor.leave'), danger: true }))) return;
    onClose();
  }

  const patch = (uid, p) => setBook((b) => ({ ...b, entries: { ...b.entries, [uid]: { ...b.entries[uid], ...p } } }));

  function addEntry() {
    const uid = entries.length ? Math.max(...entries.map((e) => e.uid)) + 1 : 0;
    const entry = {
      uid, key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true,
      order: 100, position: 0, disable: false, excludeRecursion: false, preventRecursion: false, delayUntilRecursion: false, probability: 100,
      useProbability: true, depth: 4, group: '', groupOverride: false, groupWeight: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null,
      useGroupScoring: null, automationId: '', role: 0, sticky: null, cooldown: null, delay: null, displayIndex: uid,
    };
    setBook((b) => ({ ...b, entries: { ...b.entries, [uid]: entry } }));
    setOpen(uid);
  }

  function removeEntry(uid) {
    setBook((b) => {
      const { [uid]: _gone, ...rest } = b.entries;
      return { ...b, entries: rest };
    });
    setOpen(null);
  }

  async function save() {
    setBusy(true);
    try {
      let current = name;
      if (title.trim() && title.trim() !== name) current = (await api.renameLorebook(name, title.trim())).name;
      await api.saveLorebook(current, book);
      toast(t('lorebooks.editor.saved'));
      onClose();
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: t('lorebooks.delete_dialog.title'), message: t('lorebooks.delete_dialog.message', { name }), confirmLabel: t('common.delete'), danger: true }))) return;
    try {
      await api.deleteLorebook(name);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <div className="stack editor">
      <div className="btn-row">
        <button className="btn" onClick={goBack}>
          <Icon name="back" size={18} /> {t('common.back')}
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => downloadBlob(`${name}.json`, JSON.stringify(book, null, 2))}>
          {t('common.export')}
        </button>
        <button className="btn danger" onClick={remove}>
          {t('common.delete')}
        </button>
        <button className="btn primary" disabled={busy || !dirty} onClick={save}>
          {t('common.save')}
        </button>
      </div>
      {dirty && <p className="warn">{t('lorebooks.editor.unsaved')}</p>}
      <section className="card">
        <Field label={t('lorebooks.editor.name')}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('lorebooks.editor.description')} hint={t('lorebooks.editor.description_hint')}>
          <textarea rows={2} value={book.description || ''} onChange={(e) => setBook((b) => ({ ...b, description: e.target.value }))} />
        </Field>
      </section>
      <div className="btn-row">
        <button className="btn primary" onClick={addEntry}>
          <Icon name="plus" size={18} /> {t('lorebooks.editor.add_entry')}
        </button>
        <span className="muted">{t('lorebooks.entry_count', { count: entries.length })}</span>
      </div>
      {entries.length > 4 && <SearchBox value={filter} onChange={setFilter} placeholder={t('lorebooks.editor.search_placeholder')} />}
      {q && !visible.length && <p className="muted">{t('lorebooks.editor.no_match')}</p>}
      {visible.map((e) => (
        <section key={e.uid} className={`card entry ${e.disable ? 'disabled' : ''}`}>
          <div className="entry-head" onClick={() => setOpen(open === e.uid ? null : e.uid)}>
            <div className="grow">
              <strong>{e.comment || e.key.join(', ') || (e.constant ? t('lorebooks.editor.always_active') : t('lorebooks.editor.entry_n', { uid: e.uid }))}</strong>
              <small className="muted">{e.constant ? t('lorebooks.editor.constant_tag') : e.key.join(', ') || t('lorebooks.editor.no_keys')}</small>
            </div>
            <label className="switch" onClick={(ev) => ev.stopPropagation()}>
              <input type="checkbox" checked={!e.disable} onChange={(ev) => patch(e.uid, { disable: !ev.target.checked })} />
              <span>{t('lorebooks.editor.active')}</span>
            </label>
          </div>
          {open === e.uid && (
            <div className="entry-body">
              <Field label={t('lorebooks.editor.comment')}>
                <input value={e.comment} onChange={(ev) => patch(e.uid, { comment: ev.target.value })} />
              </Field>
              <Field label={t('lorebooks.editor.keys')}>
                <KeysInput value={e.key} onChange={(key) => patch(e.uid, { key })} />
              </Field>
              <Field label={t('lorebooks.editor.keys_secondary')}>
                <KeysInput value={e.keysecondary} onChange={(keysecondary) => patch(e.uid, { keysecondary })} />
              </Field>
              <Field label={t('lorebooks.editor.content')}>
                <textarea rows={6} value={e.content} onChange={(ev) => patch(e.uid, { content: ev.target.value })} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={e.constant} onChange={(ev) => patch(e.uid, { constant: ev.target.checked })} /> {t('lorebooks.editor.constant')}
              </label>
              <div className="grid-2">
                <Field label={t('lorebooks.editor.position')}>
                  <select value={POSITIONS.some(([v]) => v === e.position) ? e.position : 0} onChange={(ev) => patch(e.uid, { position: Number(ev.target.value) })}>
                    {POSITIONS.map(([v, k]) => (
                      <option key={v} value={v}>
                        {t(`lorebooks.positions.${k}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                {e.position === 4 && (
                  <>
                    <Field label={t('lorebooks.editor.depth')}>
                      <input type="number" min={0} value={e.depth} onChange={(ev) => patch(e.uid, { depth: Number(ev.target.value) })} />
                    </Field>
                    <Field label={t('lorebooks.editor.role')}>
                      <select value={e.role ?? 0} onChange={(ev) => patch(e.uid, { role: Number(ev.target.value) })}>
                        <option value={0}>{t('lorebooks.editor.role_system')}</option>
                        <option value={1}>{t('lorebooks.editor.role_user')}</option>
                        <option value={2}>{t('lorebooks.editor.role_assistant')}</option>
                      </select>
                    </Field>
                  </>
                )}
                <Field label={t('lorebooks.editor.order')}>
                  <input type="number" value={e.order} onChange={(ev) => patch(e.uid, { order: Number(ev.target.value) })} />
                </Field>
                <Field label={t('lorebooks.editor.probability')}>
                  <input type="number" min={0} max={100} value={e.probability} onChange={(ev) => patch(e.uid, { probability: Number(ev.target.value) })} />
                </Field>
                <Field label={t('lorebooks.editor.logic')}>
                  <select value={e.selectiveLogic} onChange={(ev) => patch(e.uid, { selectiveLogic: Number(ev.target.value), selective: true })}>
                    <option value={0}>{t('lorebooks.editor.logic_and_any')}</option>
                    <option value={3}>{t('lorebooks.editor.logic_and_all')}</option>
                    <option value={2}>{t('lorebooks.editor.logic_not_any')}</option>
                    <option value={1}>{t('lorebooks.editor.logic_not_all')}</option>
                  </select>
                </Field>
              </div>
              <div className="checks">
                <label className="check">
                  <input type="checkbox" checked={e.caseSensitive === true} onChange={(ev) => patch(e.uid, { caseSensitive: ev.target.checked ? true : null })} /> {t('lorebooks.editor.case_sensitive')}
                </label>
                <label className="check">
                  <input type="checkbox" checked={e.matchWholeWords === true} onChange={(ev) => patch(e.uid, { matchWholeWords: ev.target.checked ? true : null })} /> {t('lorebooks.editor.whole_words')}
                </label>
                <label className="check">
                  <input type="checkbox" checked={e.excludeRecursion} onChange={(ev) => patch(e.uid, { excludeRecursion: ev.target.checked })} /> {t('lorebooks.editor.exclude_recursion')}
                </label>
                <label className="check">
                  <input type="checkbox" checked={e.preventRecursion} onChange={(ev) => patch(e.uid, { preventRecursion: ev.target.checked })} /> {t('lorebooks.editor.prevent_recursion')}
                </label>
              </div>
              <button className="btn small danger" onClick={() => removeEntry(e.uid)}>
                <Icon name="trash" size={16} /> {t('lorebooks.editor.delete_entry')}
              </button>
            </div>
          )}
        </section>
      ))}
      {!entries.length && <p className="muted">{t('lorebooks.editor.no_entries')}</p>}
    </div>
  );
}
