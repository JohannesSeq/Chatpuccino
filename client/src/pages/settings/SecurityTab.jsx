import React, { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { Field } from '../../components/ui.jsx';

export default function SecurityTab() {
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
      toast('Cuenta actualizada. Se cerró la sesión en los demás dispositivos.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!(await askConfirm({ title: 'Cerrar sesiones', message: 'Se cerrará la sesión en todos los dispositivos, excepto este.', confirmLabel: 'Cerrar sesiones', danger: true }))) return;
    try {
      await api.revokeSessions();
      toast('Sesiones cerradas');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function toggleEnabled() {
    try {
      setAuth(await api.setAuthEnabled(!auth.enabled, togglePass));
      setTogglePass('');
      toast(auth.enabled ? 'Inicio de sesión desactivado' : 'Inicio de sesión activado');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={saveAccount}>
        <h3>Cuenta</h3>
        <p className="muted">Sesión iniciada como <strong>{auth.username || '—'}</strong>. Para cambiar el usuario o la contraseña confirma tu contraseña actual.</p>
        <Field label="Usuario">
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" />
        </Field>
        <Field label="Nueva contraseña" hint="Mínimo 6 caracteres. Déjala vacía para conservar la actual.">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Repetir nueva contraseña">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        {mismatch && <p className="err">Las contraseñas no coinciden.</p>}
        <Field label="Contraseña actual">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <button className="btn primary" disabled={busy || !current || mismatch || unchanged}>
          Guardar cambios
        </button>
      </form>

      <section className="card">
        <h3>Sesiones</h3>
        <div className="btn-row">
          <button className="btn" onClick={logout}>
            Cerrar sesión
          </button>
          <button className="btn" onClick={revoke}>
            Cerrar sesión en todos los dispositivos
          </button>
        </div>
        <p className="muted">Las sesiones duran 30 días. Tras 5 intentos fallidos seguidos, el acceso se bloquea unos segundos (cada vez más).</p>
      </section>

      <section className="card">
        <h3>Requerir inicio de sesión</h3>
        <p className="muted">
          {auth.enabled
            ? 'Ahora mismo cualquiera que llegue al servidor necesita usuario y contraseña. Desactívalo solo si lo usas en un equipo de confianza.'
            : 'El inicio de sesión está desactivado: cualquiera con acceso a la red del servidor puede usar la app y ver tu API key guardada.'}
        </p>
        <Field label="Confirma tu contraseña">
          <input type="password" value={togglePass} onChange={(e) => setTogglePass(e.target.value)} autoComplete="current-password" />
        </Field>
        <button className={`btn ${auth.enabled ? 'danger' : 'primary'}`} disabled={!togglePass} onClick={toggleEnabled}>
          {auth.enabled ? 'Desactivar inicio de sesión' : 'Activar inicio de sesión'}
        </button>
      </section>
    </div>
  );
}
