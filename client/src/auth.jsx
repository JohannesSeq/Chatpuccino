import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(null);

  useEffect(() => {
    api.me().then(setAuth).catch(() => setAuth({ authenticated: false, enabled: true }));
    const expired = () => setAuth((a) => (a ? { ...a, authenticated: false } : a));
    window.addEventListener('auth:expired', expired);
    return () => window.removeEventListener('auth:expired', expired);
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setAuth((a) => ({ ...a, authenticated: false, username: null }));
  }, []);

  if (!auth) return <div className="empty">Cargando…</div>;
  if (!auth.authenticated) return <LoginPage onLogin={setAuth} />;
  return <AuthCtx.Provider value={{ auth, setAuth, logout }}>{children}</AuthCtx.Provider>;
}

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await api.login(username, password));
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Chatpuccino</h1>
        <p className="muted">Inicia sesión para continuar</p>
        <label className="field">
          <span className="field-label">Usuario</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Contraseña</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="err">{error}</p>}
        <button className="btn primary" disabled={busy || !username || !password}>
          Entrar
        </button>
      </form>
    </div>
  );
}
