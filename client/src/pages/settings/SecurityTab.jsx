import React, { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { Field } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';

export default function SecurityTab() {
  const { t } = useT();
  const { auth, setAuth, logout } = useAuth();
  const { toast } = useData();
  const { confirm: askConfirm } = useDialog();

  const [current, setCurrent] = useState('');
  const [username, setUsername] = useState(auth.username || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [togglePass, setTogglePass] = useState('');

  const mismatch = password && password !== confirm;
  const unchanged = !password && username.trim() === auth.username;

  async function saveAccount(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await api.updateAccount({ current, username, password });
      setAuth(next);
      setCurrent('');
      setPassword('');
      setConfirm('');
      toast(t('security.account.updated'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!(await askConfirm(    { title: t('security.sessions.revoke_title'), message: t('security.sessions.revoke_message'), confirmLabel: t('security.sessions.revoke_confirm'), danger: true }))) return;
    try {
      await api.revokeSessions();
          toast(t('security.sessions.revoked'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function toggleEnabled() {
    try {
      setAuth(await api.setAuthEnabled(!auth.enabled, togglePass));
      setTogglePass('');
      toast(auth.enabled ? t('security.require.disabled') : t('security.require.enabled'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={saveAccount}>
        <h3>{t('security.account.title')}</h3>
        <p className="muted">
          {t('security.account.logged_as_before')}
          <strong>{auth.username || '—'}</strong>
          {t('security.account.logged_as_after')}
        </p>
        <Field label={t('security.account.username')}>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" />
        </Field>
        <Field label={t('security.account.new_password')} hint={t('security.account.new_password_hint')}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label={t('security.account.repeat_password')}>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        {mismatch && <p className="err">{t('security.account.mismatch')}</p>}
        <Field label={t('security.account.current_password')}>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <button className="btn primary" disabled={busy || !current || mismatch || unchanged}>
          {t('security.account.save')}
        </button>
      </form>

      <section className="card">
        <h3>{t('security.sessions.title')}</h3>
        <div className="btn-row">
          <button className="btn" onClick={logout}>
            {t('security.sessions.logout')}
          </button>
          <button className="btn" onClick={revoke}>
            {t('security.sessions.logout_all')}
          </button>
        </div>
        <p className="muted">{t('security.sessions.note')}</p>
      </section>

      <section className="card">
        <h3>{t('security.require.title')}</h3>
        <p className="muted">{auth.enabled ? t('security.require.on_note') : t('security.require.off_note')}</p>
        <Field label={t('security.require.confirm_password')}>
          <input type="password" value={togglePass} onChange={(e) => setTogglePass(e.target.value)} autoComplete="current-password" />
        </Field>
        <button className={`btn ${auth.enabled ? 'danger' : 'primary'}`} disabled={!togglePass} onClick={toggleEnabled}>
          {auth.enabled ? t('security.require.disable') : t('security.require.enable')}
        </button>
      </section>
    </div>
  );
}
