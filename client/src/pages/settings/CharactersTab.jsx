import React, { useMemo, useRef, useState } from 'react';
import { api, assistantDescribeImage } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { useFileDrop } from '../../useFileDrop.js';
import { fileToPngDataUrl, imageToJpegDataUrl, placeholderPngDataUrl } from '../../util.js';
import { AiButton } from '../../components/AiAssist.jsx';
import { Icon } from '../../components/Icon.jsx';
import TagPicker from '../../components/TagPicker.jsx';
import { CharAvatar, DropOverlay, Field, SearchBox } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';

const isPngFile = (f) => /\.png$/i.test(f.name) || f.type === 'image/png';
const isJsonFile = (f) => /\.json$/i.test(f.name) || f.type === 'application/json';
const guessName = (filename) => filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

export default function CharactersTab() {
  const { t } = useT();
  const { characters, refresh, toast } = useData();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  // Imágenes sin datos de personaje: cada una abre el editor de «Nuevo personaje», una tras otra.
  const [pending, setPending] = useState([]);
  const fileRef = useRef(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((c) => !q || c.name.toLowerCase().includes(q) || c.tags.some((tag) => tag.toLowerCase().includes(q)));
  }, [characters, query]);

  // Tarjetas (PNG con metadatos o JSON) se importan; cualquier otra imagen sirve para crear un personaje nuevo.
  async function handleFiles(files) {
    let ok = 0;
    const images = [];
    for (const f of files) {
      if (isJsonFile(f) || isPngFile(f)) {
        try {
          await api.importCharacter(f);
          ok++;
        } catch (err) {
          if (err.code === 'NO_CARD') images.push(f);
          else toast(err.message, 'error');
        }
      } else if (f.type.startsWith('image/')) {
        images.push(f);
      } else {
        toast(t('characters.import.unsupported_format', { name: f.name }), 'error');
      }
    }
    if (ok) {
      toast(t('characters.import.imported', { count: ok }));
      await refresh('characters');
    }
    if (images.length) {
      setPending(images);
      setEditing('new');
    }
  }

  const dragging = useFileDrop(handleFiles, !editing);

  async function onImport(e) {
    const files = [...e.target.files];
    e.target.value = '';
    await handleFiles(files);
  }

  if (editing) {
    const initialFile = editing === 'new' ? pending[0] : undefined;
    const remaining = editing === 'new' ? pending.length - 1 : 0;
    return (
      <CharacterEditor
        key={editing === 'new' ? `new-${pending.length}` : editing}
        id={editing === 'new' ? null : editing}
        initialFile={initialFile}
        remaining={remaining}
        onClose={async (changed) => {
          if (changed) await refresh('characters', 'lorebooks', 'chats');
          if (changed && remaining > 0) {
            setPending((p) => p.slice(1));
            return;
          }
          setPending([]);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="stack">
      {dragging && <DropOverlay title={t('characters.drop.title')} hint={t('characters.drop.hint')} />}
      <div className="btn-row">
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> {t('characters.list.new')}
        </button>
        <button className="btn" onClick={() => fileRef.current.click()}>
          {t('characters.list.import_button')}
        </button>
        <input ref={fileRef} type="file" accept=".png,.json,image/*,application/json" multiple hidden onChange={onImport} />
      </div>
      <p className="muted">{t('characters.list.tip')}</p>
      <SearchBox value={query} onChange={setQuery} placeholder={t('characters.list.search_placeholder')} />
      <div className="grid-cards">
        {list.map((c) => (
          <button key={c.id} className="char-card" onClick={() => setEditing(c.id)}>
            <CharAvatar character={c} size={64} />
            <strong>{c.name}</strong>
            <small>{c.tags.slice(0, 3).join(' · ') || c.description || t('characters.list.no_description')}</small>
          </button>
        ))}
      </div>
      {!list.length && <p className="muted">{characters.length ? t('characters.list.no_results') : t('characters.list.empty')}</p>}
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

export function CharacterEditor({ id, initialFile, remaining = 0, onClose }) {
  const { t } = useT();
  const { characters, lorebooks, toast } = useData();
  const { confirm } = useDialog();
  const [data, setData] = useState(id ? null : { ...EMPTY, name: initialFile ? guessName(initialFile.name) : '' });
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const fileRef = useRef(null);
  const sourceFile = useRef(null);
  const readAbort = useRef(null);
  const knownTags = useMemo(() => characters.flatMap((c) => c.tags || []), [characters]);

  async function applyFile(file) {
    if (!file?.type?.startsWith('image/')) {
      toast(t('characters.editor.not_image'), 'error');
      return;
    }
    try {
      const png = await fileToPngDataUrl(file, 512, 768);
      sourceFile.current = file;
      setImage(png);
      setPreview(png);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Soltar una imagen en cualquier parte del editor cambia el avatar.
  const dragging = useFileDrop((files) => applyFile(files.find((f) => f.type.startsWith('image/')) || files[0]));

  React.useEffect(() => {
    if (initialFile) applyFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => () => readAbort.current?.abort(), []);

  React.useEffect(() => {
    if (!id) return;
    api.character(id).then(({ data: d, mtime }) => {
      setData(d);
      setPreview(`/api/characters/${encodeURIComponent(id)}/avatar?v=${mtime}`);
    }).catch((e) => {
      toast(e.message, 'error');
      onClose(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!data) return <p className="muted">{t('common.loading')}</p>;
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const setExt = (k, v) => setData((d) => ({ ...d, extensions: { ...d.extensions, [k]: v } }));
  const greetings = data.alternate_greetings;
  const imageReading = data.extensions?.image_reading || '';
  // Resto de la ficha: el asistente lo usa como contexto al generar o mejorar un campo.
  const aiContext = { name: data.name, tags: data.tags, description: data.description, personality: data.personality, scenario: data.scenario, first_mes: data.first_mes, mes_example: data.mes_example, image_reading: imageReading };
  const ai = (field, label, value, onApply) => <AiButton field={field} label={label} value={value} onApply={onApply} context={aiContext} />;

  async function readImage() {
    if (imageReading.trim() && !(await confirm({ title: t('characters.editor.reading.replace_title'), message: t('characters.editor.reading.replace_message'), confirmLabel: t('characters.editor.reading.replace_confirm') }))) return;
    const ac = new AbortController();
    readAbort.current = ac;
    setReading(true);
    try {
      const source = sourceFile.current || (await (await fetch(preview)).blob());
      const dataUrl = await imageToJpegDataUrl(source, 1024);
      setExt('image_reading', '');
      let text = '';
      const out = await assistantDescribeImage({ image: dataUrl, name: data.name }, ac.signal, (d) => {
        text += d;
        setExt('image_reading', text);
      });
      if (out?.text) setExt('image_reading', out.text);
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'error');
    } finally {
      readAbort.current = null;
      setReading(false);
    }
  }

  function addReadingToDescription() {
    const text = imageReading.trim();
    if (!text || data.description.includes(text)) return;
    set('description', data.description.trim() ? `${data.description.trimEnd()}\n\n${text}` : text);
    toast(t('characters.editor.added_to_description'));
  }

  async function pickImage(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await applyFile(file);
  }

  async function save() {
    if (!data.name.trim()) return toast(t('characters.editor.name_required'), 'error');
    setBusy(true);
    const extensions = { ...data.extensions };
    if (!String(extensions.image_reading || '').trim()) delete extensions.image_reading;
    const payload = { ...data, name: data.name.trim(), extensions };
    try {
      if (id) await api.updateCharacter(id, payload, image);
      else await api.createCharacter(payload, image || placeholderPngDataUrl(payload.name));
      toast(t('characters.editor.saved'));
      onClose(true);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: t('characters.editor.delete_title'), message: t('characters.editor.delete_message', { name: data.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    try {
      await api.deleteCharacter(id);
      onClose(true, { deleted: true });
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
      toast(t('characters.editor.lorebook.extracted', { name }));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const bookEntries = data.character_book ? (Array.isArray(data.character_book.entries) ? data.character_book.entries.length : Object.keys(data.character_book.entries || {}).length) : 0;

  return (
    <div className="stack editor">
      {dragging && <DropOverlay title={t('characters.drop.avatar_title')} />}
      {remaining > 0 && <p className="muted">{t('characters.editor.remaining', { count: remaining })}</p>}
      <div className="btn-row">
        <button className="btn" onClick={() => onClose(false)}>
          <Icon name="back" size={18} /> {t('common.back')}
        </button>
        <span className="spacer" />
        {id && (
          <button className="btn danger" onClick={remove}>
            {t('common.delete')}
          </button>
        )}
        <button className="btn primary" disabled={busy} onClick={save}>
          {t('common.save')}
        </button>
      </div>

      <section className="card">
        <div className="avatar-edit">
          <div>
            <button className="portrait" onClick={() => fileRef.current.click()} aria-label={t('characters.editor.change_image')}>
              {preview ? <img src={preview} alt="" /> : <span>{t('characters.editor.no_image')}</span>}
            </button>
            <p className="portrait-hint">{t('characters.editor.image_hint')}</p>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
          <div className="grow">
            <Field label={t('characters.editor.fields.name')}>
              <input value={data.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <div className="field">
              <span className="field-label">{t('characters.editor.fields.tags')}</span>
              <TagPicker value={data.tags || []} onChange={(tags) => set('tags', tags)} options={knownTags} />
            </div>
            {id && (
              <div className="btn-row">
                <a className="btn small" href={`/api/characters/${encodeURIComponent(id)}/export`}>
                  {t('characters.editor.export_png')}
                </a>
                <a className="btn small" href={`/api/characters/${encodeURIComponent(id)}/export?format=json`}>
                  {t('characters.editor.export_json')}
                </a>
              </div>
            )}
          </div>
        </div>
        <div className="image-reading">
          <Field
            label={t('characters.editor.fields.image_reading')}
            hint={t('characters.editor.hints.image_reading')}
            action={ai('image_reading', t('characters.editor.fields.image_reading'), imageReading, (v) => setExt('image_reading', v))}
          >
            <textarea rows={4} value={imageReading} readOnly={reading} onChange={(e) => setExt('image_reading', e.target.value)} placeholder={t('characters.editor.reading.placeholder')} />
          </Field>
          <div className="btn-row">
            {reading ? (
              <button className="btn small" onClick={() => readAbort.current?.abort()}>
                <Icon name="stop" size={16} /> {t('common.stop')}
              </button>
            ) : (
              <button className="btn small" onClick={readImage} disabled={!preview}>
                <Icon name="image" size={16} /> {t('characters.editor.reading.read')}
              </button>
            )}
            <button className="btn small" onClick={addReadingToDescription} disabled={reading || !imageReading.trim()}>
              {t('characters.editor.reading.add_to_description')}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <Field label={t('characters.editor.fields.description')} hint={t('characters.editor.hints.description')} action={ai('description', t('characters.editor.fields.description'), data.description, (v) => set('description', v))}>
          <textarea rows={8} value={data.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label={t('characters.editor.fields.personality')} action={ai('personality', t('characters.editor.fields.personality'), data.personality, (v) => set('personality', v))}>
          <textarea rows={3} value={data.personality} onChange={(e) => set('personality', e.target.value)} />
        </Field>
        <Field label={t('characters.editor.fields.scenario')} action={ai('scenario', t('characters.editor.fields.scenario'), data.scenario, (v) => set('scenario', v))}>
          <textarea rows={3} value={data.scenario} onChange={(e) => set('scenario', e.target.value)} />
        </Field>
        <Field label={t('characters.editor.fields.first_message')} action={ai('first_mes', t('characters.editor.fields.first_message'), data.first_mes, (v) => set('first_mes', v))}>
          <textarea rows={5} value={data.first_mes} onChange={(e) => set('first_mes', e.target.value)} />
        </Field>
        <Field label={t('characters.editor.fields.dialogue_examples')} hint={t('characters.editor.hints.dialogue_examples')} action={ai('mes_example', t('characters.editor.fields.dialogue_examples'), data.mes_example, (v) => set('mes_example', v))}>
          <textarea rows={5} value={data.mes_example} onChange={(e) => set('mes_example', e.target.value)} />
        </Field>
      </section>

      <section className="card">
        <h3>{t('characters.editor.greetings.title')}</h3>
        {greetings.map((g, i) => (
          <div key={i} className="inline top">
            <textarea rows={3} value={g} onChange={(e) => set('alternate_greetings', greetings.map((x, k) => (k === i ? e.target.value : x)))} />
            <div className="greeting-actions">
              {ai('alternate_greeting', t('characters.editor.ai_labels.alternate_greeting', { number: i + 1 }), g, (v) => set('alternate_greetings', greetings.map((x, k) => (k === i ? v : x))))}
              <button className="icon-btn" onClick={() => set('alternate_greetings', greetings.filter((_, k) => k !== i))} aria-label={t('common.remove')}>
                <Icon name="trash" />
              </button>
            </div>
          </div>
        ))}
        <button className="btn small" onClick={() => set('alternate_greetings', [...greetings, ''])}>
          <Icon name="plus" size={16} /> {t('characters.editor.greetings.add')}
        </button>
      </section>

      <section className="card">
        <h3>{t('characters.editor.lorebook.title')}</h3>
        <Field label={t('characters.editor.lorebook.linked')} hint={t('characters.editor.hints.lorebook')}>
          <select value={data.extensions?.world || ''} onChange={(e) => setExt('world', e.target.value)}>
            <option value="">{t('common.none')}</option>
            {lorebooks.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
            {data.extensions?.world && !lorebooks.some((b) => b.name === data.extensions.world) && <option value={data.extensions.world}>{t('characters.editor.lorebook.missing', { name: data.extensions.world })}</option>}
          </select>
        </Field>
        {data.character_book && (
          <p className="muted">
            {t('characters.editor.lorebook.embedded', { count: bookEntries })}{' '}
            <button className="btn small" onClick={extractBook}>
              {t('characters.editor.lorebook.extract')}
            </button>
          </p>
        )}
      </section>

      <details className="card">
        <summary>{t('characters.editor.advanced')}</summary>
        <Field label={t('characters.editor.fields.system_prompt')} action={ai('system_prompt', t('characters.editor.ai_labels.system_prompt'), data.system_prompt, (v) => set('system_prompt', v))}>
          <textarea rows={4} value={data.system_prompt} onChange={(e) => set('system_prompt', e.target.value)} />
        </Field>
        <Field label={t('characters.editor.fields.post_history')} action={ai('post_history_instructions', t('characters.editor.fields.post_history'), data.post_history_instructions, (v) => set('post_history_instructions', v))}>
          <textarea rows={3} value={data.post_history_instructions} onChange={(e) => set('post_history_instructions', e.target.value)} />
        </Field>
        <Field label={t('characters.editor.fields.creator_notes')} action={ai('creator_notes', t('characters.editor.fields.creator_notes'), data.creator_notes, (v) => set('creator_notes', v))}>
          <textarea rows={3} value={data.creator_notes} onChange={(e) => set('creator_notes', e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label={t('characters.editor.fields.creator')}>
            <input value={data.creator} onChange={(e) => set('creator', e.target.value)} />
          </Field>
          <Field label={t('characters.editor.fields.version')}>
            <input value={data.character_version} onChange={(e) => set('character_version', e.target.value)} />
          </Field>
        </div>
      </details>
    </div>
  );
}
