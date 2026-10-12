import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Field, Modal } from '../../components/ui.jsx';

const SAMPLERS = [
  ['temperature', 'Temperatura', 0, 2, 0.05],
  ['top_p', 'Top P', 0, 1, 0.01],
  ['top_k', 'Top K (0 = desactivado)', 0, 200, 1],
  ['top_a', 'Top A (0 = desactivado)', 0, 1, 0.01],
  ['min_p', 'Min P (0 = desactivado)', 0, 1, 0.01],
  ['frequency_penalty', 'Penalización de frecuencia', -2, 2, 0.05],
  ['presence_penalty', 'Penalización de presencia', -2, 2, 0.05],
  ['repetition_penalty', 'Penalización de repetición (1 = ninguna)', 0, 2, 0.05],
  ['openai_max_tokens', 'Máx. tokens de respuesta', 16, 32768, 16],
  ['openai_max_context', 'Contexto máximo (tokens)', 1024, 2000000, 512],
];

const MARKER_HELP = {
  charDescription: 'Descripción del personaje (de su tarjeta). En grupos incluye la de cada miembro.',
  charPersonality: 'Personalidad del personaje, con el formato definido abajo.',
  scenario: 'Escenario de la tarjeta, con el formato definido abajo.',
  personaDescription: 'Descripción de tu persona.',
  worldInfoBefore: 'Entradas de lorebook configuradas «antes del personaje».',
  worldInfoAfter: 'Entradas de lorebook configuradas «después del personaje».',
  dialogueExamples: 'Ejemplos de diálogo de la tarjeta.',
  chatHistory: 'Los mensajes del chat. Los prompts que quedan debajo se envían después del historial.',
};

const FORMAT_FIELDS = [
  ['new_chat_prompt', 'Inicio de chat', 'Se inserta justo antes del historial.'],
  ['new_group_chat_prompt', 'Inicio de chat de grupo', '{{group}} = nombres de los miembros.'],
  ['new_example_chat_prompt', 'Antes de cada ejemplo de diálogo', ''],
  ['group_nudge_prompt', 'Aviso final en grupos', 'Se añade tras el historial. {{char}} = quien responde.'],
  ['wi_format', 'Formato de lorebook', '{0} = contenido de las entradas activadas.'],
  ['scenario_format', 'Formato del escenario', '{{scenario}} = texto del escenario.'],
  ['personality_format', 'Formato de la personalidad', '{{personality}} = texto de la personalidad.'],
];

const tokens = (s) => Math.ceil((s || '').length / 3.5);
const newId = () => `custom-${Math.random().toString(36).slice(2, 9)}`;
const roleLabel = { system: 'sistema', user: 'usuario', assistant: 'asistente' };

function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.click();
}

export default function PresetsTab() {
  const { refresh, toast } = useData();
  const { confirm, prompt } = useDialog();
  const [list, setList] = useState(null);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState('');
  const [editing, setEditing] = useState(null);
  const fileRef = useRef(null);
  const dirty = Boolean(draft) && JSON.stringify(draft) !== saved;

  const load = useCallback(async (n) => {
    const p = await api.preset(n);
    setName(n);
    setDraft(p);
    setSaved(JSON.stringify(p));
  }, []);

  const fail = useCallback((e) => toast(e.message, 'error'), [toast]);

  useEffect(() => {
    api.presets().then(async (l) => {
      setList(l);
      await load(l.active);
    }).catch(fail);
  }, [load, fail]);

  const discardOk = () =>
    !dirty ||
    confirm({ title: 'Cambios sin guardar', message: 'Este preset tiene cambios sin guardar. Si continúas se perderán.', confirmLabel: 'Descartar cambios', danger: true });
  const nameTaken = (v) => (list?.presets || []).some((n) => n.toLowerCase() === v.toLowerCase());

  async function activate(n) {
    await api.saveSettings({ activePreset: n });
    setList(await api.presets());
    await load(n);
    refresh('settings');
  }

  const run = (fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      fail(e);
    }
  };

  const choose = run(async (n) => {
    if (n !== name && (await discardOk())) await activate(n);
  });

  const save = run(async () => {
    const res = await api.savePreset(name, draft);
    setDraft(res);
    setSaved(JSON.stringify(res));
    toast('Preset guardado');
  });

  const saveAs = run(async () => {
    const n = await prompt({
      title: 'Guardar como…',
      message: 'Se crea un preset nuevo con el contenido actual (incluidos los cambios sin guardar) y pasa a ser el activo.',
      label: 'Nombre del preset',
      defaultValue: `${name} (copia)`,
      confirmLabel: 'Crear',
      validate: (v) => (nameTaken(v) ? 'Ya existe un preset con ese nombre' : ''),
    });
    if (!n) return;
    const created = await api.createPreset(n, draft);
    await activate(created.name);
    toast(`Preset «${created.name}» creado`);
  });

  const createBlank = run(async () => {
    if (!(await discardOk())) return;
    const n = await prompt({
      title: 'Nuevo preset',
      message: 'Parte de los valores por defecto.',
      label: 'Nombre del preset',
      placeholder: 'Mi preset',
      confirmLabel: 'Crear',
      validate: (v) => (nameTaken(v) ? 'Ya existe un preset con ese nombre' : ''),
    });
    if (!n) return;
    await activate((await api.createPreset(n)).name);
  });

  const rename = run(async () => {
    const n = await prompt({
      title: 'Renombrar preset',
      label: 'Nuevo nombre',
      defaultValue: name,
      confirmLabel: 'Renombrar',
      validate: (v) => (v !== name && nameTaken(v) ? 'Ya existe un preset con ese nombre' : ''),
    });
    if (!n || n === name) return;
    const r = await api.renamePreset(name, n);
    setList(await api.presets());
    setName(r.name);
    refresh('settings');
  });

  const remove = run(async () => {
    if (!(await confirm({ title: 'Eliminar preset', message: `Se eliminará el preset «${name}». No se puede deshacer.`, confirmLabel: 'Eliminar', danger: true }))) return;
    await api.deletePreset(name);
    const l = await api.presets();
    await activate(l.presets.includes('Default') ? 'Default' : l.presets[0]);
  });

  const onImport = run(async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length || !(await discardOk())) return;
    let last = null;
    for (const f of files) {
      try {
        last = (await api.importPreset(f.name.replace(/\.json$/i, ''), JSON.parse(await f.text()))).name;
      } catch (err) {
        toast(`${f.name}: ${err.message}`, 'error');
      }
    }
    if (last) {
      await activate(last);
      toast('Preset importado');
    }
  });

  const exportPreset = async () => {
    if (dirty && !(await confirm({ title: 'Cambios sin guardar', message: 'Se exportará la versión guardada del preset, sin tus cambios actuales.', confirmLabel: 'Exportar igualmente' }))) return;
    download(`/api/presets/${encodeURIComponent(name)}/export`);
  };

  const order = draft?.prompt_order[0].order || [];
  const byId = useMemo(() => new Map((draft?.prompts || []).map((p) => [p.identifier, p])), [draft]);
  const setParam = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setOrder = (o) => setDraft((d) => ({ ...d, prompt_order: d.prompt_order.map((x) => ({ ...x, order: o })) }));
  const move = (i, dir) => {
    const o = [...order];
    const j = i + dir;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setOrder(o);
  };
  const toggle = (i) => setOrder(order.map((x, k) => (k === i ? { ...x, enabled: !x.enabled } : x)));

  const upsertPrompt = (p, isNew) => {
    setDraft((d) => ({
      ...d,
      prompts: isNew ? [...d.prompts, p] : d.prompts.map((x) => (x.identifier === p.identifier ? p : x)),
      prompt_order: isNew ? d.prompt_order.map((o) => ({ ...o, order: [...o.order, { identifier: p.identifier, enabled: true }] })) : d.prompt_order,
    }));
    setEditing(null);
  };

  const deletePrompt = (identifier) => {
    setDraft((d) => ({
      ...d,
      prompts: d.prompts.filter((p) => p.identifier !== identifier),
      prompt_order: d.prompt_order.map((o) => ({ ...o, order: o.order.filter((x) => x.identifier !== identifier) })),
    }));
    setEditing(null);
  };

  const totalTokens = order.reduce((n, o) => {
    const p = byId.get(o.identifier);
    return o.enabled && p && !p.marker ? n + tokens(p.content) : n;
  }, 0);

  if (!list || !draft) return <p className="muted">Cargando…</p>;

  return (
    <div className="stack">
      <section className="card">
        <h3>Preset</h3>
        <p className="muted">
          Un preset guarda los parámetros de generación y la lista ordenada de prompts que se envía al modelo. Es el mismo formato de «Chat Completion» de SillyTavern: puedes importar y exportar los de allí.
        </p>
        <Field label="Preset en uso">
          <select value={name} onChange={(e) => choose(e.target.value)}>
            {list.presets.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        {dirty && <p className="warn">Cambios sin guardar</p>}
        <div className="btn-row">
          <button className="btn primary" disabled={!dirty} onClick={save}>
            Guardar
          </button>
          <button className="btn" onClick={saveAs}>
            Guardar como…
          </button>
          <button className="btn" onClick={createBlank}>
            <Icon name="plus" size={16} /> Nuevo
          </button>
        </div>
        <div className="btn-row">
          <button className="btn small" onClick={rename}>
            Renombrar
          </button>
          <button className="btn small" onClick={() => fileRef.current.click()}>
            Importar JSON
          </button>
          <button className="btn small" onClick={exportPreset}>
            Exportar JSON
          </button>
          <button className="btn small danger" disabled={list.presets.length < 2} onClick={remove}>
            Eliminar
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden onChange={onImport} />
        </div>
      </section>

      <section className="card">
        <h3>Prompts</h3>
        <p className="muted">
          Se envían en este orden, de arriba abajo. Desactiva los que no quieras y reordénalos con las flechas. «Historial» es donde van los mensajes del chat. Total de prompts activos: ~{totalTokens} tokens (sin contar el contenido automático).
        </p>
        <ul className="prompt-list">
          {order.map((o, i) => {
            const p = byId.get(o.identifier);
            if (!p) return null;
            return (
              <li key={o.identifier} className={`prompt-row ${o.enabled ? '' : 'off'}`}>
                <div className="reorder">
                  <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                    <Icon name="up" size={18} />
                  </button>
                  <button className="icon-btn" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                    <Icon name="down" size={18} />
                  </button>
                </div>
                <button className="prompt-main" onClick={() => setEditing(o.identifier)}>
                  <strong>{p.name}</strong>
                  <small>
                    {p.marker ? <span className="tag">automático</span> : <span className="tag">{roleLabel[p.role]}</span>}
                    {!p.marker && p.injection_position === 1 && <span className="tag">en el chat · prof. {p.injection_depth}</span>}
                    {!p.marker && <span className="muted"> ~{tokens(p.content)} tokens</span>}
                    {!p.marker && !p.content.trim() && <span className="muted"> · vacío</span>}
                  </small>
                </button>
                <label className="switch" title={o.enabled ? 'Activo' : 'Desactivado'}>
                  <input type="checkbox" checked={o.enabled} onChange={() => toggle(i)} />
                </label>
              </li>
            );
          })}
        </ul>
        <button className="btn" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> Añadir prompt
        </button>
      </section>

      <section className="card">
        <h3>Muestreo</h3>
        <div className="grid-2">
          {SAMPLERS.map(([key, label, min, max, step]) => (
            <Field key={key} label={label}>
              <input type="number" inputMode="decimal" min={min} max={max} step={step} value={draft[key]} onChange={(e) => setParam(key, e.target.value)} />
            </Field>
          ))}
        </div>
      </section>

      <details className="card">
        <summary>Mensajes auxiliares y formatos</summary>
        <label className="check">
          <input type="checkbox" checked={draft.squash_system_messages} onChange={(e) => setParam('squash_system_messages', e.target.checked)} /> Unir mensajes de sistema consecutivos en uno (más compatible con la mayoría de modelos)
        </label>
        {FORMAT_FIELDS.map(([key, label, hint]) => (
          <Field key={key} label={label} hint={hint}>
            <textarea rows={2} value={draft[key]} onChange={(e) => setParam(key, e.target.value)} />
          </Field>
        ))}
      </details>

      {editing && (
        <PromptEditor
          prompt={editing === 'new' ? null : byId.get(editing)}
          onClose={() => setEditing(null)}
          onSave={upsertPrompt}
          onDelete={deletePrompt}
        />
      )}
    </div>
  );
}

function PromptEditor({ prompt, onClose, onSave, onDelete }) {
  const isNew = !prompt;
  const { confirm } = useDialog();
  const [p, setP] = useState(() => prompt || { identifier: newId(), name: '', role: 'system', content: '', marker: false, system_prompt: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [], forbid_overrides: false });
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const canOverride = p.identifier === 'main' || p.identifier === 'jailbreak';
  const deletable = !isNew && !p.marker && !p.system_prompt;

  return (
    <Modal
      title={isNew ? 'Nuevo prompt' : p.name || 'Prompt'}
      onClose={onClose}
      footer={
        <>
          {deletable && (
            <button
              className="btn danger"
              onClick={async () => {
                if (await confirm({ title: 'Eliminar prompt', message: `Se quitará «${p.name}» de este preset (al guardar).`, confirmLabel: 'Eliminar', danger: true })) onDelete(p.identifier);
              }}
            >
              Eliminar
            </button>
          )}
          <span className="spacer" />
          <button className="btn primary" disabled={!p.name.trim()} onClick={() => onSave({ ...p, name: p.name.trim(), injection_depth: Number(p.injection_depth) || 0, injection_order: Number(p.injection_order) || 0 }, isNew)}>
            {p.marker ? 'Guardar nombre' : 'Aplicar'}
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input value={p.name} onChange={(e) => set('name', e.target.value)} autoFocus={isNew} />
      </Field>
      {p.marker ? (
        <p className="muted">{MARKER_HELP[p.identifier] || 'Bloque automático.'} Su contenido no se edita aquí.</p>
      ) : (
        <>
          <Field label="Rol">
            <select value={p.role} onChange={(e) => set('role', e.target.value)}>
              <option value="system">Sistema</option>
              <option value="user">Usuario</option>
              <option value="assistant">Asistente</option>
            </select>
          </Field>
          <Field label="Contenido" hint="Admite {{char}}, {{user}}, {{group}}, {{date}}, {{time}} y {{random:a,b}}.">
            <textarea rows={9} value={p.content} onChange={(e) => set('content', e.target.value)} />
          </Field>
          <Field label="Posición">
            <select value={p.injection_position} onChange={(e) => set('injection_position', Number(e.target.value))}>
              <option value={0}>Relativa (según el orden de la lista)</option>
              <option value={1}>En el chat (a cierta profundidad del historial)</option>
            </select>
          </Field>
          {p.injection_position === 1 && (
            <div className="grid-2">
              <Field label="Profundidad" hint="0 = tras el último mensaje, 1 = antes del último…">
                <input type="number" min={0} value={p.injection_depth} onChange={(e) => set('injection_depth', e.target.value)} />
              </Field>
              <Field label="Orden" hint="Si varios coinciden, menor va antes.">
                <input type="number" value={p.injection_order} onChange={(e) => set('injection_order', e.target.value)} />
              </Field>
            </div>
          )}
          {canOverride && (
            <label className="check">
              <input type="checkbox" checked={p.forbid_overrides} onChange={(e) => set('forbid_overrides', e.target.checked)} /> Impedir que la tarjeta del personaje lo reemplace
            </label>
          )}
        </>
      )}
    </Modal>
  );
}
