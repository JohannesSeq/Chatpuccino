import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PROFILE_KINDS } from '../../../../shared/studio.js';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { useT } from '../../i18n.jsx';
import { useStudio } from './StudioContext.jsx';
import { useLocalPref } from './ui.jsx';
import ConnectionCard from './settings/ConnectionCard.jsx';
import ModelCard from './settings/ModelCard.jsx';
import ProfileCard from './settings/ProfileCard.jsx';
import PromptsCard from './settings/PromptsCard.jsx';
import { buildPatch, clone, formFromConfig } from './settings/form.js';
import '../../styles/studio-settings.css';

export default function SettingsPanel() {
  const { t } = useT();
  const { toast } = useData();
  const { confirm } = useDialog();
  const { config, loadError, reload, save, options, loadOptions } = useStudio();
  const [form, setForm] = useState(null);
  const [storedKind, setKind] = useLocalPref('chatpuccino.studio.settings.profile', 'character');
  const kind = PROFILE_KINDS.includes(storedKind) ? storedKind : 'character';
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // El formulario se crea una vez con la configuración cargada; recargar (p. ej. por los favoritos) no pisa lo que se está editando.
  useEffect(() => {
    if (config && !form) setForm(formFromConfig(config));
  }, [config, form]);

  useEffect(() => {
    if (config?.ready) loadOptions();
  }, [config?.ready, loadOptions]);

  const patch = useMemo(() => (form && config ? buildPatch(form, config) : {}), [form, config]);
  const dirty = Object.keys(patch).length > 0;
  const dirtyKinds = Object.keys(patch.profiles || {});

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setSection = useCallback((section, change) => setForm((f) => ({ ...f, [section]: { ...f[section], ...change } })), []);
  const setProfile = useCallback((k, change) => setForm((f) => ({ ...f, profiles: { ...f.profiles, [k]: { ...f.profiles[k], ...change } } })), []);

  if (!config || !form) {
    return loadError ? (
      <div className="card stack">
        <p className="err">{loadError}</p>
        <div className="btn-row">
          <button className="btn" onClick={() => reload().catch(() => {})}>
            {t('studio.settings.retry')}
          </button>
        </div>
      </div>
    ) : (
      <p className="muted" role="status">
        {t('common.loading')}
      </p>
    );
  }

  const favorites = config.model.favorites;
  const canSave = dirty || !config.configured;

  const onSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const connectionChanged = Boolean(patch.connection);
      const next = await save(patch);
      setForm(formFromConfig(next));
      toast(t('studio.settings.saved'));
      if (next.ready && (connectionChanged || options.status !== 'ready')) loadOptions(true);
    } catch (e) {
      setSaveError(e.message);
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const onDiscard = async () => {
    if (await confirm({ title: t('studio.settings.discard'), message: t('studio.settings.discard_confirm'), confirmLabel: t('studio.settings.discard'), danger: true })) setForm(formFromConfig(config));
  };

  const toggleFavorite = async (name) => {
    try {
      await api.toggleStudioFavorite(name);
      await reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const addManual = async (name) => {
    try {
      if (!favorites.includes(name)) {
        await api.toggleStudioFavorite(name);
        await reload();
      }
      setSection('model', { checkpoint: name });
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const resetProfile = async () => {
    const ok = await confirm({
      title: t('studio.settings.profile.reset_title'),
      message: t('studio.settings.profile.reset_confirm', { profile: t(`studio.settings.profile.kinds.${kind}`) }),
      confirmLabel: t('studio.settings.profile.reset'),
      danger: true,
    });
    if (ok) setProfile(kind, clone(config.defaults.profiles[kind]));
  };

  const setExpression = (label, text) => setForm((f) => ({ ...f, expressionPrompts: { ...f.expressionPrompts, [label]: text } }));
  const resetExpressions = () => setForm((f) => ({ ...f, expressionPrompts: { ...config.defaults.expressionPrompts } }));

  return (
    <div className="stack set-panel">
      {!config.configured && !dirty && <p className="muted set-first">{t('studio.settings.first_run')}</p>}

      <ConnectionCard value={form.connection} hasPass={config.connection.hasPass} onChange={(c) => setSection('connection', c)} />

      <ModelCard value={form.model} onChange={(m) => setSection('model', m)} favorites={favorites} options={options} onReload={() => loadOptions(true)} onToggleFavorite={toggleFavorite} onAddManual={addManual} />

      <ProfileCard kind={kind} onKindChange={setKind} dirtyKinds={dirtyKinds} value={form.profiles[kind]} onChange={(c) => setProfile(kind, c)} options={options} onReset={resetProfile} />

      <PromptsCard
        kind={kind}
        value={form.profiles[kind]}
        defaults={config.defaults.profiles[kind]}
        onChange={(c) => setProfile(kind, c)}
        expressionPrompts={form.expressionPrompts}
        defaultExpressionPrompts={config.defaults.expressionPrompts}
        onExpressionChange={setExpression}
        onExpressionsReset={resetExpressions}
      />

      <div className={`set-savebar ${dirty ? 'dirty' : ''}`}>
        <span className="grow set-savebar-msg" role="status" aria-live="polite">
          {saveError ? <span className="err">{saveError}</span> : dirty ? t('studio.settings.unsaved') : config.configured ? t('studio.settings.up_to_date') : t('studio.settings.not_saved_yet')}
        </span>
        {dirty && (
          <button type="button" className="btn" onClick={onDiscard} disabled={saving}>
            {t('studio.settings.discard')}
          </button>
        )}
        <button type="button" className="btn primary" onClick={onSave} disabled={saving || !canSave}>
          {saving ? t('studio.settings.saving') : t('studio.settings.save')}
        </button>
      </div>
    </div>
  );
}
