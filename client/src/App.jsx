import React from 'react';
import { NavLink, Navigate, Route, Routes, useMatch } from 'react-router-dom';
import { Icon } from './components/Icon.jsx';
import ChatsPage from './pages/ChatsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { useData } from './data.jsx';

export default function App() {
  const inChat = useMatch('/chats/:kind/:owner/:file');
  const { ready } = useData();
  return (
    <div className={`app ${inChat ? 'in-chat' : ''}`}>
      <nav className="nav">
        <NavLink to="/chats" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="chat" />
          <span>Chats</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="tune" />
          <span>Ajustes</span>
        </NavLink>
      </nav>
      <main className="main">
        {!ready ? (
          <div className="empty">Cargando…</div>
        ) : (
          <Routes>
            <Route path="/" element={<Navigate to="/chats" replace />} />
            <Route path="/chats/*" element={<ChatsPage />} />
            <Route path="/settings/:tab?" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/chats" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
