import React, { useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { fileToPngDataUrl, placeholderPngDataUrl } from '../../util.js';
import { Icon } from '../../components/Icon.jsx';
import { CharAvatar, Field, SearchBox } from '../../components/ui.jsx';

export default function CharactersTab() {
  const { characters, refresh, toast } = useData();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const fileRef = useRef(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => !q || c.name.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q)));
  }, [characters, query]);

  async function onImport(e) {
    const files = [...e.target.files];
    e.target.value = '';
    let ok = 0;
    for (const f of files) {
      try {
        await api.importCharacter(f);
        ok++;
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    if (ok) toast(`${ok} personaje(s) importado(s)`);
    await refresh('characters');
  }

  if (editing) {
    return (
      <CharacterEditor
        id={editing === 'new' ? null : editing}
        onClose={async (changed) => {
          setEditing(null);
          if (changed) await refresh('characters', 'lorebooks', 'chats');
        }}
      />
    );
  }

  return (
    <div className="stack">
      <div className="btn-row">
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> Nuevo personaje
        </button>
        <button className="btn" onClick={() => fileRef.current.click()}>
          Importar (PNG / JSON)
        </button>
        <input ref={fileRef} type="file" accept=".png,.json,image/png,application/json" multiple hidden onChange={onImport} />
      </div>
      <SearchBox value={query} onChange={setQuery} placeholder="Buscar personajes o etiquetas" />
      <div className="grid-cards">
        {list.map((c) => (
          <button key={c.id} className="char-card" onClick={() => setEditing(c.id)}>
            <CharAvatar character={c} size={64} />
            <strong>{c.name}</strong>
            <small>{c.tags.slice(0, 3).join(' · ') || c.description || 'Sin descripción'}</small>
          </button>
        ))}
      </div>
      {!list.length && <p className="muted">{characters.length ? 'Sin resultados.' : 'Todavía no hay personajes. Importa tarjetas PNG de SillyTavern o crea una nueva.'}</p>}
    </div>
  );
}

const EMPTY = {
  name: '',
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  creator_notes: '',
  system_prompt: '',
  post_history_instructions: '',
  alternate_greetings: [],
  tags: [],
  creator: '',
  character_version: '',
  extensions: {},
};

function CharacterEditor({ id, onClose }) {
  const { lorebooks, toast } = useData();
  const [data, setData] = useState(id ? null : { ...EMPTY });
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [tagsText, setTagsText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  React.useEffect(() => {
    if (!id) return;
    api.character(id).then(({ data: d, mtime }) => {
      setData(d);
      setTagsText(d.tags.join(', '));
      setPreview(`/api/characters/${encodeURIComponent(id)}/avatar?v=${mtime}`);
    }).catch((e) => {
      toast(e.message, 'error');
      onClose(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!data) return <p className="muted">Cargando…</p>;
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const setExt = (k, v) => setData((d) => ({ ...d, extensions: { ...d.extensions, [k]: v } }));
  const greetings = data.alternate_greetings;

  async function pickImage(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const png = await fileToPngDataUrl(file, 512, 768);
      setImage(png);
      setPreview(png);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function save() {
    if (!data.name.trim()) return toast('El nombre es obligatorio', 'error');
    setBusy(true);
    const payload = { ...data, name: data.name.trim(), tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean) };
    try {
      if (id) await api.updateCharacter(id, payload, image);
      else await api.createCharacter(payload, image || placeholderPngDataUrl(payload.name));
      toast('Personaje guardado');
      onClose(true);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`¿Eliminar a ${data.name}? También se borrarán todos sus chats.`)) return;
    try {
      await api.deleteCharacter(id);
      onClose(true);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function extractBook() {
    try {
      const { name } = await api.createLorebook(`${data.name}`, data.character_book);
      setData((d) => {
        const { character_book, ...rest } = d;
        return { ...rest, extensions: { ...rest.extensions, world: name } };
      });
      toast(`Lorebook "${name}" creado. Guarda el personaje para vincularlo.`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const bookEntries = data.character_book ? (Array.isArray(data.character_book.entries) ? data.character_book.entries.length : Object.keys(data.character_book.entries || {}).length) : 0;

  return (
    <div className="stack editor">
      <div className="btn-row">
        <button className="btn" onClick={() => onClose(false)}>
          <Icon name="back" size={18} /> Volver
        </button>
        <span className="spacer" />
        {id && (
          <button className="btn danger" onClick={remove}>
            Eliminar
          </button>
        )}
        <button className="btn primary" disabled={busy} onClick={save}>
          Guardar
        </button>
      </div>

      <section className="card">
        <div className="avatar-edit">
          <button className="portrait" onClick={() => fileRef.current.click()} aria-label="Cambiar imagen">
            {preview ? <img src={preview} alt="" /> : <span>Sin imagen</span>}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
          <div className="grow">
            <Field label="Nombre">
              <input value={data.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Etiquetas (separadas por coma)">
              <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
            </Field>
            {id && (
              <div className="btn-row">
                <a className="btn small" href={`/api/characters/${encodeURIComponent(id)}/export`}>
                  Exportar PNG
                </a>
                <a className="btn small" href={`/api/characters/${encodeURIComponent(id)}/export?format=json`}>
                  Exportar JSON
                </a>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <Field label="Descripción" hint="Quién es el personaje. Usa {{char}} y {{user}}.">
          <textarea rows={8} value={data.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Personalidad">
          <textarea rows={3} value={data.personality} onChange={(e) => set('personality', e.target.value)} />
        </Field>
        <Field label="Escenario">
          <textarea rows={3} value={data.scenario} onChange={(e) => set('scenario', e.target.value)} />
        </Field>
        <Field label="Primer mensaje">
          <textarea rows={5} value={data.first_mes} onChange={(e) => set('first_mes', e.target.value)} />
        </Field>
        <Field label="Ejemplos de diálogo" hint="Separa cada ejemplo con <START>.">
          <textarea rows={5} value={data.mes_example} onChange={(e) => set('mes_example', e.target.value)} />
        </Field>
      </section>

      <section className="card">
        <h3>Saludos alternativos</h3>
        {greetings.map((g, i) => (
          <div key={i} className="inline top">
            <textarea rows={3} value={g} onChange={(e) => set('alternate_greetings', greetings.map((x, k) => (k === i ? e.target.value : x)))} />
            <button className="icon-btn" onClick={() => set('alternate_greetings', greetings.filter((_, k) => k !== i))} aria-label="Quitar">
              <Icon name="trash" />
            </button>
          </div>
        ))}
        <button className="btn small" onClick={() => set('alternate_greetings', [...greetings, ''])}>
          <Icon name="plus" size={16} /> Añadir saludo
        </button>
      </section>

      <section className="card">
        <h3>Lorebook</h3>
        <Field label="Lorebook vinculado" hint="Siempre activo en los chats de este personaje.">
          <select value={data.extensions?.world || ''} onChange={(e) => setExt('world', e.target.value)}>
            <option value="">Ninguno</option>
            {lorebooks.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
            {data.extensions?.world && !lorebooks.some((b) => b.name === data.extensions.world) && <option value={data.extensions.world}>{data.extensions.world} (no existe)</option>}
          </select>
        </Field>
        {data.character_book && (
          <p className="muted">
            Esta tarjeta incluye un lorebook embebido ({bookEntries} entradas) que se usa automáticamente.{' '}
            <button className="btn small" onClick={extractBook}>
              Extraer a lorebook
            </button>
          </p>
        )}
      </section>

      <details className="card">
        <summary>Avanzado</summary>
        <Field label="Prompt de sistema (reemplaza al global)">
          <textarea rows={4} value={data.system_prompt} onChange={(e) => set('system_prompt', e.target.value)} />
        </Field>
        <Field label="Instrucciones posteriores al historial">
          <textarea rows={3} value={data.post_history_instructions} onChange={(e) => set('post_history_instructions', e.target.value)} />
        </Field>
        <Field label="Notas del creador">
          <textarea rows={3} value={data.creator_notes} onChange={(e) => set('creator_notes', e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Creador">
            <input value={data.creator} onChange={(e) => set('creator', e.target.value)} />
          </Field>
          <Field label="Versión">
            <input value={data.character_version} onChange={(e) => set('character_version', e.target.value)} />
          </Field>
        </div>
      </details>
    </div>
  );
}
