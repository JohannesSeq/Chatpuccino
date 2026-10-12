import React, { useRef, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { downloadBlob } from '../../util.js';
import { Icon } from '../../components/Icon.jsx';
import { Field, Menu, Modal, SearchBox } from '../../components/ui.jsx';

export default function LorebooksTab() {
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
      title: 'Renombrar lorebook',
      label: 'Nuevo nombre',
      defaultValue: name,
      confirmLabel: 'Renombrar',
      validate: (v) => (taken(v, name) ? 'Ya existe un lorebook con ese nombre' : ''),
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
      await api.createLorebook(`${name} (copia)`, book);
      await refresh('lorebooks');
      toast('Lorebook duplicado');
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
    const ok = await confirm({ title: 'Eliminar lorebook', message: `Se eliminará «${name}» con todas sus entradas. No se puede deshacer.`, confirmLabel: 'Eliminar', danger: true });
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
      <p className="muted">Los lorebooks activos aquí se aplican a todos los chats. También puedes vincular uno a un personaje desde su ficha. Compatibles con World Info de SillyTavern.</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} /> Nuevo lorebook
        </button>
        <button className="btn" onClick={() => fileRef.current.click()}>
          Importar JSON
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
                  {b.entryCount} {b.entryCount === 1 ? 'entrada' : 'entradas'}
                  {b.description ? ` · ${b.description}` : ''}
                </div>
              </div>
            </button>
            <label className="switch" title="Activo en todos los chats">
              <input type="checkbox" checked={settings.activeLorebooks.includes(b.name)} onChange={() => toggleActive(b.name)} />
              <span>Global</span>
            </label>
            <Menu
              items={[
                { label: 'Editar', onClick: () => setEditing(b.name) },
                { label: 'Renombrar', onClick: () => rename(b.name) },
                { label: 'Duplicar', onClick: () => duplicate(b.name) },
                { label: 'Exportar JSON', onClick: () => exportBook(b.name) },
                { label: 'Eliminar', danger: true, onClick: () => remove(b.name) },
              ]}
            />
          </li>
        ))}
        {!lorebooks.length && <li className="empty small">No hay lorebooks. Crea uno nuevo o importa un JSON de SillyTavern.</li>}
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
  const { toast } = useData();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const error = trimmed && taken(trimmed) ? 'Ya existe un lorebook con ese nombre' : '';

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
      title="Nuevo lorebook"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!trimmed || Boolean(error) || busy} onClick={submit}>
            Crear y editar
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="Nombre">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mundo de Eldoria" autoFocus autoComplete="off" />
          {error && <span className="field-error">{error}</span>}
        </Field>
        <Field label="Descripción (opcional)" hint="Solo para ti: de qué trata este lorebook.">
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function GlobalLoreSettings({ settings, onSaved, toast }) {
  const [scanDepth, setScanDepth] = useState(settings.scanDepth);
  const [loreBudget, setLoreBudget] = useState(settings.loreBudget);
  async function save() {
    try {
      await api.saveSettings({ scanDepth, loreBudget });
      toast('Guardado');
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  return (
    <section className="card">
      <h3>Activación</h3>
      <div className="grid-2">
        <Field label="Profundidad de escaneo (mensajes)">
          <input type="number" min={1} value={scanDepth} onChange={(e) => setScanDepth(e.target.value)} />
        </Field>
        <Field label="Presupuesto (tokens)">
          <input type="number" min={0} step={128} value={loreBudget} onChange={(e) => setLoreBudget(e.target.value)} />
        </Field>
      </div>
      <button className="btn" onClick={save}>
        Guardar
      </button>
    </section>
  );
}

const POSITIONS = [
  [0, 'Antes de la descripción del personaje'],
  [1, 'Después de la descripción del personaje'],
  [4, 'A profundidad N en el chat'],
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

  if (!book) return <p className="muted">Cargando…</p>;
  const entries = Object.values(book.entries).sort((a, b) => a.uid - b.uid);
  const dirty = JSON.stringify(book) !== saved || title.trim() !== name;
  const q = filter.trim().toLowerCase();
  const visible = q ? entries.filter((e) => [e.comment, e.content, ...e.key, ...e.keysecondary].some((s) => String(s).toLowerCase().includes(q))) : entries;

  async function goBack() {
    if (dirty && !(await confirm({ title: 'Cambios sin guardar', message: 'Este lorebook tiene cambios sin guardar. Si sales se perderán.', confirmLabel: 'Salir sin guardar', danger: true }))) return;
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
      toast('Lorebook guardado');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: 'Eliminar lorebook', message: `Se eliminará «${name}» con todas sus entradas. No se puede deshacer.`, confirmLabel: 'Eliminar', danger: true }))) return;
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
          <Icon name="back" size={18} /> Volver
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => downloadBlob(`${name}.json`, JSON.stringify(book, null, 2))}>
          Exportar
        </button>
        <button className="btn danger" onClick={remove}>
          Eliminar
        </button>
        <button className="btn primary" disabled={busy || !dirty} onClick={save}>
          Guardar
        </button>
      </div>
      {dirty && <p className="warn">Cambios sin guardar</p>}
      <section className="card">
        <Field label="Nombre">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Descripción" hint="Solo para ti.">
          <textarea rows={2} value={book.description || ''} onChange={(e) => setBook((b) => ({ ...b, description: e.target.value }))} />
        </Field>
      </section>
      <div className="btn-row">
        <button className="btn primary" onClick={addEntry}>
          <Icon name="plus" size={18} /> Añadir entrada
        </button>
        <span className="muted">
          {entries.length} {entries.length === 1 ? 'entrada' : 'entradas'}
        </span>
      </div>
      {entries.length > 4 && <SearchBox value={filter} onChange={setFilter} placeholder="Buscar en las entradas" />}
      {q && !visible.length && <p className="muted">Ninguna entrada coincide.</p>}
      {visible.map((e) => (
        <section key={e.uid} className={`card entry ${e.disable ? 'disabled' : ''}`}>
          <div className="entry-head" onClick={() => setOpen(open === e.uid ? null : e.uid)}>
            <div className="grow">
              <strong>{e.comment || e.key.join(', ') || (e.constant ? 'Siempre activa' : `Entrada ${e.uid}`)}</strong>
              <small className="muted">{e.constant ? 'constante' : e.key.join(', ') || 'sin claves'}</small>
            </div>
            <label className="switch" onClick={(ev) => ev.stopPropagation()}>
              <input type="checkbox" checked={!e.disable} onChange={(ev) => patch(e.uid, { disable: !ev.target.checked })} />
              <span>Activa</span>
            </label>
          </div>
          {open === e.uid && (
            <div className="entry-body">
              <Field label="Título / comentario (solo para ti)">
                <input value={e.comment} onChange={(ev) => patch(e.uid, { comment: ev.target.value })} />
              </Field>
              <Field label="Claves (separadas por coma; admite /regex/i)">
                <KeysInput value={e.key} onChange={(key) => patch(e.uid, { key })} />
              </Field>
              <Field label="Claves secundarias (opcional)">
                <KeysInput value={e.keysecondary} onChange={(keysecondary) => patch(e.uid, { keysecondary })} />
              </Field>
              <Field label="Contenido">
                <textarea rows={6} value={e.content} onChange={(ev) => patch(e.uid, { content: ev.target.value })} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={e.constant} onChange={(ev) => patch(e.uid, { constant: ev.target.checked })} /> Constante (siempre incluida)
              </label>
              <div className="grid-2">
                <Field label="Posición">
                  <select value={POSITIONS.some(([v]) => v === e.position) ? e.position : 0} onChange={(ev) => patch(e.uid, { position: Number(ev.target.value) })}>
                    {POSITIONS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                {e.position === 4 && (
                  <>
                    <Field label="Profundidad">
                      <input type="number" min={0} value={e.depth} onChange={(ev) => patch(e.uid, { depth: Number(ev.target.value) })} />
                    </Field>
                    <Field label="Rol">
                      <select value={e.role ?? 0} onChange={(ev) => patch(e.uid, { role: Number(ev.target.value) })}>
                        <option value={0}>Sistema</option>
                        <option value={1}>Usuario</option>
                        <option value={2}>Asistente</option>
                      </select>
                    </Field>
                  </>
                )}
                <Field label="Orden (mayor = más prioridad)">
                  <input type="number" value={e.order} onChange={(ev) => patch(e.uid, { order: Number(ev.target.value) })} />
                </Field>
                <Field label="Probabilidad (%)">
                  <input type="number" min={0} max={100} value={e.probability} onChange={(ev) => patch(e.uid, { probability: Number(ev.target.value) })} />
                </Field>
                <Field label="Lógica de claves secundarias">
                  <select value={e.selectiveLogic} onChange={(ev) => patch(e.uid, { selectiveLogic: Number(ev.target.value), selective: true })}>
                    <option value={0}>Y cualquiera</option>
                    <option value={3}>Y todas</option>
                    <option value={2}>Ninguna</option>
                    <option value={1}>No todas</option>
                  </select>
                </Field>
              </div>
              <div className="checks">
                <label className="check">
                  <input type="checkbox" checked={e.caseSensitive === true} onChange={(ev) => patch(e.uid, { caseSensitive: ev.target.checked ? true : null })} /> Distinguir mayúsculas
                </label>
                <label className="check">
                  <input type="checkbox" checked={e.matchWholeWords === true} onChange={(ev) => patch(e.uid, { matchWholeWords: ev.target.checked ? true : null })} /> Palabras completas
                </label>
                <label className="check">
                  <input type="checkbox" checked={e.excludeRecursion} onChange={(ev) => patch(e.uid, { excludeRecursion: ev.target.checked })} /> No activar por recursión
                </label>
                <label className="check">
                  <input type="checkbox" checked={e.preventRecursion} onChange={(ev) => patch(e.uid, { preventRecursion: ev.target.checked })} /> Evitar recursión
                </label>
              </div>
              <button className="btn small danger" onClick={() => removeEntry(e.uid)}>
                <Icon name="trash" size={16} /> Eliminar entrada
              </button>
            </div>
          )}
        </section>
      ))}
      {!entries.length && <p className="muted">Este lorebook aún no tiene entradas.</p>}
    </div>
  );
}
