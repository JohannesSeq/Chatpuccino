import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Field, Modal } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';
import { SAMPLERS } from '../../samplers.js';

const MARKER_IDS = ['charDescription', 'charPersonality', 'scenario', 'personaDescription', 'worldInfoBefore', 'worldInfoAfter', 'dialogueExamples', 'chatHistory'];

// [clave, ¿tiene pista?]; los textos se buscan en `presets.formats.<clave>`.
const FORMAT_FIELDS = [
  ['new_chat_prompt', true],
  ['new_group_chat_prompt', true],
  ['new_example_chat_prompt', false],
  ['group_nudge_prompt', true],
  ['impersonation_prompt', true],
  ['wi_format', true],
  ['scenario_format', true],
  ['personality_format', true],
];

const tokens = (s) => Math.ceil((s || '').length / 3.5);
const newId = () => `custom-${Math.random().toString(36).slice(2, 9)}`;

function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.click();
}

export default function PresetsTab() {
  const { t } = useT();
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
    confirm({ title: t('presets.unsaved'), message: t('presets.discard.message'), confirmLabel: t('presets.discard.confirm'), danger: true });
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
    toast(t('presets.saved'));
  });

  const saveAs = run(async () => {
    const n = await prompt({
      title: t('presets.save_as'),
      message: t('presets.save_as_dialog.message'),
      label: t('presets.name_label'),
      defaultValue: t('presets.save_as_dialog.default_name', { name }),
      confirmLabel: t('common.create'),
      validate: (v) => (nameTaken(v) ? t('presets.name_taken') : ''),
    });
    if (!n) return;
    const created = await api.createPreset(n, draft);
    await activate(created.name);
    toast(t('presets.created', { name: created.name }));
  });

  const createBlank = run(async () => {
    if (!(await discardOk())) return;
    const n = await prompt({
      title: t('presets.new_dialog.title'),
      message: t('presets.new_dialog.message'),
      label: t('presets.name_label'),
      placeholder: t('presets.new_dialog.placeholder'),
      confirmLabel: t('common.create'),
      validate: (v) => (nameTaken(v) ? t('presets.name_taken') : ''),
    });
    if (!n) return;
    await activate((await api.createPreset(n)).name);
  });

  const rename = run(async () => {
    const n = await prompt({
      title: t('presets.rename_dialog.title'),
      label: t('presets.rename_dialog.label'),
      defaultValue: name,
      confirmLabel: t('common.rename'),
      validate: (v) => (v !== name && nameTaken(v) ? t('presets.name_taken') : ''),
    });
    if (!n || n === name) return;
    const r = await api.renamePreset(name, n);
    setList(await api.presets());
    setName(r.name);
    refresh('settings');
  });

  const remove = run(async () => {
    if (!(await confirm({ title: t('presets.delete_dialog.title'), message: t('presets.delete_dialog.message', { name }), confirmLabel: t('common.delete'), danger: true }))) return;
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
      toast(t('presets.imported'));
    }
  });

  const exportPreset = async () => {
    if (dirty && !(await confirm({ title: t('presets.unsaved'), message: t('presets.export_dialog.message'), confirmLabel: t('presets.export_dialog.confirm') }))) return;
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

  if (!list || !draft) return <p className="muted">{t('common.loading')}</p>;

  return (
    <div className="stack">
      <section className="card">
        <h3>{t('presets.title')}</h3>
        <p className="muted">{t('presets.intro')}</p>
        <Field label={t('presets.active_label')}>
          <select value={name} onChange={(e) => choose(e.target.value)}>
            {list.presets.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        {dirty && <p className="warn">{t('presets.unsaved')}</p>}
        <div className="btn-row">
          <button className="btn primary" disabled={!dirty} onClick={save}>
            {t('common.save')}
          </button>
          <button className="btn" onClick={saveAs}>
            {t('presets.save_as')}
          </button>
          <button className="btn" onClick={createBlank}>
            <Icon name="plus" size={16} /> {t('common.new')}
          </button>
        </div>
        <div className="btn-row">
          <button className="btn small" onClick={rename}>
            {t('common.rename')}
          </button>
          <button className="btn small" onClick={() => fileRef.current.click()}>
            {t('presets.import_json')}
          </button>
          <button className="btn small" onClick={exportPreset}>
            {t('presets.export_json')}
          </button>
          <button className="btn small danger" disabled={list.presets.length < 2} onClick={remove}>
            {t('common.delete')}
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden onChange={onImport} />
        </div>
      </section>

      <section className="card">
        <h3>{t('presets.prompts.title')}</h3>
        <p className="muted">{t('presets.prompts.intro', { tokens: totalTokens })}</p>
        <ul className="prompt-list">
          {order.map((o, i) => {
            const p = byId.get(o.identifier);
            if (!p) return null;
            return (
              <li key={o.identifier} className={`prompt-row ${o.enabled ? '' : 'off'}`}>
                <div className="reorder">
                  <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('presets.prompts.move_up')}>
                    <Icon name="up" size={18} />
                  </button>
                  <button className="icon-btn" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={t('presets.prompts.move_down')}>
                    <Icon name="down" size={18} />
                  </button>
                </div>
                <button className="prompt-main" onClick={() => setEditing(o.identifier)}>
                  <strong>{p.name}</strong>
                  <small>
                    {p.marker ? <span className="tag">{t('presets.prompts.auto')}</span> : <span className="tag">{t(`presets.role_tag.${p.role}`)}</span>}
                    {!p.marker && p.injection_position === 1 && <span className="tag">{t('presets.prompts.in_chat', { depth: p.injection_depth })}</span>}
                    {!p.marker && <span className="muted"> {t('presets.prompts.tokens', { tokens: tokens(p.content) })}</span>}
                    {!p.marker && !p.content.trim() && <span className="muted"> · {t('presets.prompts.empty')}</span>}
                  </small>
                </button>
                <label className="switch" title={o.enabled ? t('presets.prompts.enabled') : t('presets.prompts.disabled')}>
                  <input type="checkbox" checked={o.enabled} onChange={() => toggle(i)} />
                </label>
              </li>
            );
          })}
        </ul>
        <button className="btn" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> {t('presets.prompts.add')}
        </button>
      </section>

      <section className="card">
        <h3>{t('presets.sampling.title')}</h3>
        <div className="grid-2">
          {SAMPLERS.map(([key, min, max, step]) => (
            <Field key={key} label={t(`samplers.${key}`)}>
              <input type="number" inputMode="decimal" min={min} max={max} step={step} value={draft[key]} onChange={(e) => setParam(key, e.target.value)} />
            </Field>
          ))}
        </div>
      </section>

      <details className="card">
        <summary>{t('presets.aux.title')}</summary>
        <label className="check">
          <input type="checkbox" checked={draft.squash_system_messages} onChange={(e) => setParam('squash_system_messages', e.target.checked)} /> {t('presets.aux.squash')}
        </label>
        {FORMAT_FIELDS.map(([key, hasHint]) => (
          <Field key={key} label={t(`presets.formats.${key}.label`)} hint={hasHint ? t(`presets.formats.${key}.hint`) : ''}>
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
  const { t } = useT();
  const { confirm } = useDialog();
  const [p, setP] = useState(() => prompt || { identifier: newId(), name: '', role: 'system', content: '', marker: false, system_prompt: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [], forbid_overrides: false });
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  const canOverride = p.identifier === 'main' || p.identifier === 'jailbreak';
  const deletable = !isNew && !p.marker && !p.system_prompt;

  return (
    <Modal
      title={isNew ? t('presets.editor.new_title') : p.name || t('presets.editor.fallback_title')}
      onClose={onClose}
      footer={
        <>
          {deletable && (
            <button
              className="btn danger"
              onClick={async () => {
                if (await confirm({ title: t('presets.editor.delete_title'), message: t('presets.editor.delete_message', { name: p.name }), confirmLabel: t('common.delete'), danger: true })) onDelete(p.identifier);
              }}
            >
              {t('common.delete')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn primary" disabled={!p.name.trim()} onClick={() => onSave({ ...p, name: p.name.trim(), injection_depth: Number(p.injection_depth) || 0, injection_order: Number(p.injection_order) || 0 }, isNew)}>
            {p.marker ? t('presets.editor.save_name') : t('presets.editor.apply')}
          </button>
        </>
      }
    >
      <Field label={t('presets.editor.name')}>
        <input value={p.name} onChange={(e) => set('name', e.target.value)} autoFocus={isNew} />
      </Field>
      {p.marker ? (
        <p className="muted">{MARKER_IDS.includes(p.identifier) ? t(`presets.markers.${p.identifier}`) : t('presets.markers.default')} {t('presets.markers.readonly')}</p>
      ) : (
        <>
          <Field label={t('presets.editor.role')}>
            <select value={p.role} onChange={(e) => set('role', e.target.value)}>
              <option value="system">{t('presets.editor.role_system')}</option>
              <option value="user">{t('presets.editor.role_user')}</option>
              <option value="assistant">{t('presets.editor.role_assistant')}</option>
            </select>
          </Field>
          <Field label={t('presets.editor.content')} hint={t('presets.editor.content_hint')}>
            <textarea rows={9} value={p.content} onChange={(e) => set('content', e.target.value)} />
          </Field>
          <Field label={t('presets.editor.position')}>
            <select value={p.injection_position} onChange={(e) => set('injection_position', Number(e.target.value))}>
              <option value={0}>{t('presets.editor.position_relative')}</option>
              <option value={1}>{t('presets.editor.position_chat')}</option>
            </select>
          </Field>
          {p.injection_position === 1 && (
            <div className="grid-2">
              <Field label={t('presets.editor.depth')} hint={t('presets.editor.depth_hint')}>
                <input type="number" min={0} value={p.injection_depth} onChange={(e) => set('injection_depth', e.target.value)} />
              </Field>
              <Field label={t('presets.editor.order')} hint={t('presets.editor.order_hint')}>
                <input type="number" value={p.injection_order} onChange={(e) => set('injection_order', e.target.value)} />
              </Field>
            </div>
          )}
          {canOverride && (
            <label className="check">
              <input type="checkbox" checked={p.forbid_overrides} onChange={(e) => set('forbid_overrides', e.target.checked)} /> {t('presets.editor.forbid_overrides')}
            </label>
          )}
        </>
      )}
    </Modal>
  );
}
