import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { currentLocale, useT } from '../../i18n.jsx';
import { Icon } from '../Icon.jsx';
import MultiPicker from '../MultiPicker.jsx';
import { AiButton } from '../AiAssist.jsx';
import { Field, Modal } from '../ui.jsx';
import '../../styles/novel-list.css';

const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
};

// world: configuración completa, elemento de la lista (se carga la configuración entera) o null para crear.
// onClose(result): { changed, id?, deleted?, created? }
export default function WorldEditor({ world, onClose }) {
  const { characters, personas, lorebooks, stats, backgrounds, refresh, toast } = useData();
  const { confirm } = useDialog();
  const { t } = useT();
  const needsLoad = Boolean(world?.id) && world.lorebooks === undefined;
  const [config, setConfig] = useState(needsLoad ? null : world);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!needsLoad) return undefined;
    let alive = true;
    api
      .world(world.id)
      .then((r) => alive && setConfig(r.world))
      .catch((e) => {
        if (!alive) return;
        toast(e.message, 'error');
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [needsLoad, world?.id, toast]);

  useEffect(() => {
    if (failed) onClose({ changed: false });
  }, [failed, onClose]);

  useEffect(() => {
    if (needsLoad && !config) return;
    const src = config || {};
    setForm({
      name: src.name || '',
      description: src.description || '',
      characters: src.characters || [],
      active: config ? src.active || [] : src.characters || [],
      lorebooks: src.lorebooks || [],
      statIds: src.statIds || [],
      background: src.background || '',
      persona: src.persona || '',
      classic: Boolean(src.classic),
    });
  }, [config, needsLoad]);

  const charOptions = useMemo(() => characters.map((c) => ({ id: c.id, label: c.name })), [characters]);
  const activeOptions = useMemo(() => charOptions.filter((o) => form?.characters.includes(o.id)), [charOptions, form?.characters]);
  const loreOptions = useMemo(() => lorebooks.map((b) => ({ id: b.name, label: b.name })), [lorebooks]);
  const statOptions = useMemo(() => stats.map((s) => ({ id: s.id, label: s.name, sub: s.scope === 'world' ? t('world_editor.scope.world') : t('world_editor.scope.character') })), [stats, t]);

  const isEdit = Boolean(world?.id);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const bg = form && backgrounds.find((b) => b.id === form.background);
  // Contexto para el asistente de IA: reparto (con un resumen de cada personaje), estadísticas y lorebooks del mundo.
  const aiContext = form && {
    name: form.name,
    cast: form.characters
      .map((id) => characters.find((c) => c.id === id))
      .filter(Boolean)
      .map((c) => `${c.name}${c.description ? `: ${String(c.description).slice(0, 300)}` : ''}`)
      .join('\n'),
    stats: form.statIds
      .map((id) => stats.find((s) => s.id === id))
      .filter(Boolean)
      .map((s) => `${s.name}${s.description ? `: ${s.description}` : ''}`)
      .join('\n'),
    lorebooks: form.lorebooks.join(', '),
  };

  async function save() {
    setBusy(true);
    try {
      const body = { ...form, name: form.name.trim(), description: form.description.trim() };
      const saved = isEdit ? await api.updateWorld(world.id, body) : await api.createWorld(body);
      await refresh('worlds', 'stats', 'backgrounds');
      onClose({ changed: true, id: saved?.id || world?.id, created: !isEdit });
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  async function duplicate() {
    setBusy(true);
    try {
      const copy = await api.copyWorld(world.id);
      await refresh('worlds');
      toast(t('novel.duplicated'));
      onClose({ changed: true, id: copy?.id, created: true });
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: t('novel.delete_title'), message: t('novel.delete_message', { name: config?.name || world.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    setBusy(true);
    try {
      await api.deleteWorld(world.id);
      await refresh('worlds');
      onClose({ changed: true, id: world.id, deleted: true });
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  const close = () => onClose({ changed: false });
  const goLibrary = () => onClose({ changed: false });

  if (!form) {
    return (
      <Modal title={isEdit ? t('world_editor.edit_title') : t('world_editor.new_title')} onClose={close} wide>
        <div className="empty small">{t('common.loading')}</div>
      </Modal>
    );
  }

  return (
    <Modal
      wide
      title={isEdit ? t('world_editor.edit_title') : t('world_editor.new_title')}
      onClose={close}
      footer={
        <>
          {isEdit && (
            <>
              <button className="btn danger" disabled={busy} onClick={remove}>
                {t('common.delete')}
              </button>
              <button className="btn" disabled={busy} onClick={duplicate}>
                <Icon name="copy" size={18} /> {t('common.duplicate')}
              </button>
            </>
          )}
          <span className="spacer" />
          <button className="btn primary" disabled={busy || !form.name.trim()} onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="world-editor">
        <Field label={t('world_editor.name.label')}>
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('world_editor.name.placeholder')} autoFocus={!isEdit} />
        </Field>

        <Field
          label={t('world_editor.description.label')}
          hint={t('world_editor.description.hint')}
          action={<AiButton field="world_description" label={t('world_editor.ai.description')} value={form.description} onApply={(text) => set({ description: text })} context={aiContext} />}
        >
          <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder={t('world_editor.description.placeholder')} rows={5} />
        </Field>

        <div className="field">
          <span className="field-label">{t('world_editor.cast.label', { count: form.characters.length })}</span>
          <MultiPicker
            value={form.characters}
            onChange={(ids) => {
              const added = ids.filter((id) => !form.characters.includes(id));
              set({ characters: ids, active: [...form.active.filter((id) => ids.includes(id)), ...added] });
            }}
            options={charOptions}
            placeholder={t('world_editor.cast.placeholder')}
            noneLeft={characters.length ? t('world_editor.cast.none_left') : t('world_editor.cast.no_characters')}
            removeLabel={(label) => t('world_editor.remove_aria', { name: label })}
            ariaLabel={t('world_editor.cast.label', { count: form.characters.length })}
          />
          <span className="field-hint">{t('world_editor.cast.hint')}</span>
        </div>

        <div className="field">
          <span className="field-label">{t('world_editor.active.label')}</span>
          <MultiPicker
            value={form.active}
            onChange={(ids) => set({ active: ids })}
            options={activeOptions}
            placeholder={t('world_editor.active.placeholder')}
            noneLeft={form.characters.length ? t('world_editor.active.none_left') : t('world_editor.active.need_cast')}
            removeLabel={(label) => t('world_editor.remove_aria', { name: label })}
            ariaLabel={t('world_editor.active.label')}
          />
          <span className="field-hint">{t('world_editor.active.hint')}</span>
        </div>

        <div className="field">
          <span className="field-label">{t('world_editor.lorebooks.label')}</span>
          <MultiPicker
            value={form.lorebooks}
            onChange={(names) => set({ lorebooks: names })}
            options={loreOptions}
            placeholder={t('world_editor.lorebooks.placeholder')}
            noneLeft={lorebooks.length ? t('world_editor.lorebooks.none_left') : t('world_editor.lorebooks.none_exist')}
            removeLabel={(label) => t('world_editor.remove_aria', { name: label })}
            ariaLabel={t('world_editor.lorebooks.label')}
          />
          <span className="field-hint">{t('world_editor.lorebooks.hint')}</span>
        </div>

        <div className="field">
          <span className="field-label">{t('world_editor.stats.label')}</span>
          <MultiPicker
            value={form.statIds}
            onChange={(ids) => set({ statIds: ids })}
            options={statOptions}
            placeholder={t('world_editor.stats.placeholder')}
            noneLeft={stats.length ? t('world_editor.stats.none_left') : t('world_editor.stats.none_exist')}
            removeLabel={(label) => t('world_editor.remove_aria', { name: label })}
            ariaLabel={t('world_editor.stats.label')}
          />
          <span className="field-hint">
            {t('world_editor.stats.hint')}{' '}
            <Link to="/catalog/estadisticas" onClick={goLibrary}>
              {stats.length ? t('world_editor.stats.manage') : t('world_editor.stats.create')}
            </Link>
          </span>
        </div>

        <div className="field">
          <span className="field-label">{t('world_editor.background.label')}</span>
          <div className="world-bg-pick">
            <select value={form.background} onChange={(e) => set({ background: e.target.value })} aria-label={t('world_editor.background.label')}>
              <option value="">{t('world_editor.background.none')}</option>
              {backgrounds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              {form.background && !bg && <option value={form.background}>{t('world_editor.missing', { name: form.background })}</option>}
            </select>
            {bg?.url && <img className="world-bg-preview" src={bg.url} alt={t('world_editor.background.preview_alt', { name: bg.name })} />}
          </div>
          <span className="field-hint">
            {backgrounds.length ? t('world_editor.background.hint') : t('world_editor.background.none_exist')}{' '}
            <Link to="/catalog/fondos" onClick={goLibrary}>
              {backgrounds.length ? t('world_editor.background.manage') : t('world_editor.background.create')}
            </Link>
          </span>
        </div>

        <Field label={t('world_editor.persona.label')} hint={t('world_editor.persona.hint')}>
          <select value={form.persona} onChange={(e) => set({ persona: e.target.value })}>
            <option value="">{t('world_editor.persona.default')}</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {form.persona && !personas.some((p) => p.id === form.persona) && <option value={form.persona}>{t('world_editor.missing', { name: form.persona })}</option>}
          </select>
        </Field>

        <label className="check vn-classic">
          <input type="checkbox" checked={form.classic} onChange={(e) => set({ classic: e.target.checked })} />
          <span>
            <strong>{t('novelview.classic.label')}</strong>
            <small className="muted">{t('novelview.classic.hint')}</small>
          </span>
        </label>

        {isEdit && config && (
          <p className="world-dates">
            {t('world_editor.dates', { created: fmtDate(config.createdAt) || '—', updated: fmtDate(config.updatedAt) || '—' })}
          </p>
        )}
      </div>
    </Modal>
  );
}
