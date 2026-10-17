import React, { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { Icon } from '../../components/Icon.jsx';
import { AiButton } from '../../components/AiAssist.jsx';
import { Field, Modal, SearchBox } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';
import { STAT_DESCRIPTION_MAX } from '../../../../shared/vn.js';

const DEFAULT_COLOR = '#00a884';
const EMPTY = { name: '', description: '', scope: 'character', min: '0', max: '100', default: '50', color: '' };

const toForm = (s) => ({
  name: s.name,
  description: s.description || '',
  scope: s.scope === 'world' ? 'world' : 'character',
  min: String(s.min),
  max: String(s.max),
  default: String(s.default),
  color: s.color || '',
});

const num = (v) => (String(v).trim() === '' ? NaN : Number(v));

export default function StatsLibrary() {
  const { t } = useT();
  const { stats, refresh } = useData();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | stat

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stats.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q));
  }, [stats, query]);

  return (
    <div className="stack">
      <p className="muted">{t('library.stats.intro')}</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> {t('library.stats.new')}
        </button>
      </div>
      {stats.length > 0 && <SearchBox value={query} onChange={setQuery} placeholder={t('library.stats.search')} />}
      {list.length > 0 && (
        <ul className="rows library-list">
          {list.map((s) => (
            <li key={s.id} className="row">
              <button className="row-main" onClick={() => setEditing(s)}>
                <span className="stat-dot" style={s.color ? { background: s.color } : undefined} aria-hidden="true" />
                <span className="row-text">
                  <span className="stat-title">
                    <strong>{s.name}</strong>
                    <span className="tag">{t(`library.stats.scope_${s.scope === 'world' ? 'world' : 'character'}`)}</span>
                  </span>
                  <span className="row-sub stat-meta">
                    {t('library.stats.range', { min: s.min, max: s.max })} · {t('library.stats.default_value', { value: s.default })}
                  </span>
                  <span className="stat-desc">{s.description || t('library.stats.no_description')}</span>
                </span>
                <Icon name="edit" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!list.length && (
        <div className="library-empty">
          <strong>{stats.length ? t('library.stats.no_results') : t('library.stats.empty_title')}</strong>
          {!stats.length && <p className="muted">{t('library.stats.empty_text')}</p>}
        </div>
      )}
      {editing && (
        <StatEditor
          stat={editing === 'new' ? null : editing}
          onClose={async (changed) => {
            setEditing(null);
            if (changed) await refresh('stats', 'worlds');
          }}
        />
      )}
    </div>
  );
}

function StatEditor({ stat, onClose }) {
  const { t } = useT();
  const { toast } = useData();
  const { confirm } = useDialog();
  const [form, setForm] = useState(stat ? toForm(stat) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const min = num(form.min);
  const max = num(form.max);
  const def = num(form.default);
  const descLength = form.description.trim().length;
  let error = '';
  if (!form.name.trim()) error = t('library.stats.editor.name_required');
  else if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) error = t('library.stats.editor.range_invalid');
  else if (!Number.isFinite(def) || def < min || def > max) error = t('library.stats.editor.default_invalid', { min, max });
  else if (form.description.trim().length > STAT_DESCRIPTION_MAX) error = t('library.stats.editor.description_too_long', { max: STAT_DESCRIPTION_MAX });

  async function save() {
    setTouched(true);
    if (error) return;
    setBusy(true);
    const body = { name: form.name.trim(), description: form.description.trim(), scope: form.scope, min, max, default: def, color: form.color };
    try {
      if (stat) await api.updateStat(stat.id, body);
      else await api.createStat(body);
      toast(t(stat ? 'library.stats.editor.saved' : 'library.stats.editor.created'));
      onClose(true);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t('library.stats.editor.delete_title'),
      message: t('library.stats.editor.delete_message', { name: stat.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteStat(stat.id);
      toast(t('library.stats.editor.deleted'));
      onClose(true);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t(stat ? 'library.stats.editor.title_edit' : 'library.stats.editor.title_new')}
      onClose={() => onClose(false)}
      footer={
        <>
          {stat && (
            <button className="btn danger" onClick={remove} disabled={busy}>
              <Icon name="trash" size={18} /> {t('common.delete')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={() => onClose(false)} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={save} disabled={busy || (touched && Boolean(error))}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <Field label={t('library.stats.editor.name')}>
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('library.stats.editor.name_placeholder')} maxLength={60} autoFocus />
      </Field>
      <Field
        label={t('library.stats.editor.description')}
        hint={t('library.stats.editor.description_hint')}
        action={
          <AiButton
            field="stat_description"
            label={t('library.ai.stat_description')}
            value={form.description}
            onApply={(text) => set({ description: text })}
            context={{
              name: form.name,
              scope: t(form.scope === 'world' ? 'library.ai.scope_world' : 'library.ai.scope_character'),
              range: Number.isFinite(min) && Number.isFinite(max) ? t('library.ai.range_text', { min, max }) : '',
            }}
          />
        }
      >
        <textarea rows={6} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder={t('library.stats.editor.description_placeholder')} aria-invalid={descLength > STAT_DESCRIPTION_MAX} />
        <span className={descLength > STAT_DESCRIPTION_MAX ? 'field-hint desc-count err' : 'field-hint desc-count'}>{t('library.stats.editor.description_count', { count: descLength, max: STAT_DESCRIPTION_MAX })}</span>
      </Field>
      <Field label={t('library.stats.editor.scope')} hint={t(`library.stats.editor.scope_${form.scope}_help`)}>
        <select value={form.scope} onChange={(e) => set({ scope: e.target.value })}>
          <option value="character">{t('library.stats.scope_character')}</option>
          <option value="world">{t('library.stats.scope_world')}</option>
        </select>
      </Field>
      <div className="stat-numbers">
        <Field label={t('library.stats.editor.min')}>
          <input type="number" inputMode="decimal" step="any" value={form.min} onChange={(e) => set({ min: e.target.value })} />
        </Field>
        <Field label={t('library.stats.editor.max')}>
          <input type="number" inputMode="decimal" step="any" value={form.max} onChange={(e) => set({ max: e.target.value })} />
        </Field>
        <Field label={t('library.stats.editor.default')}>
          <input type="number" inputMode="decimal" step="any" value={form.default} onChange={(e) => set({ default: e.target.value })} />
        </Field>
      </div>
      <Field label={t('library.stats.editor.color')} hint={t('library.stats.editor.color_hint')} action={<span />}>
        <div className="stat-color">
          <input type="color" value={form.color || DEFAULT_COLOR} onChange={(e) => set({ color: e.target.value })} aria-label={t('library.stats.editor.color')} />
          <span className="muted">{form.color || t('library.stats.editor.color_none')}</span>
          {form.color && (
            <button className="btn small" type="button" onClick={() => set({ color: '' })}>
              {t('library.stats.editor.color_clear')}
            </button>
          )}
        </div>
      </Field>
      {touched && error && <span className="field-error" role="alert">{error}</span>}
    </Modal>
  );
}
