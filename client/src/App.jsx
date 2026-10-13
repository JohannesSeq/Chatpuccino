import React from 'react';
import { NavLink, Navigate, Route, Routes, useMatch } from 'react-router-dom';
import { Icon } from './components/Icon.jsx';
import ChatsPage from './pages/ChatsPage.jsx';
import NovelPage from './pages/NovelPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { useData } from './data.jsx';
import { useT } from './i18n.jsx';

export default function App() {
  const inChatsView = useMatch('/chats/:kind/:owner/:file');
  const novelMatch = useMatch('/novel/:worldId');
  const inChat = inChatsView || (novelMatch && novelMatch.params.worldId !== 'library');
  const { ready } = useData();
  const { t } = useT();
  return (
    <div className={`app ${inChat ? 'in-chat' : ''}`}>
      <nav className="nav">
        <NavLink to="/chats" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="chat" />
          <span>{t('app.nav.chats')}</span>
        </NavLink>
        <NavLink to="/novel" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="book" />
          <span>{t('app.nav.novel')}</span>
        </NavLink>
        <NavLink to="/catalog" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="catalog" />
          <span>{t('app.nav.catalog')}</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="tune" />
          <span>{t('app.nav.settings')}</span>
        </NavLink>
      </nav>
      <main className="main">
        {!ready ? (
          <div className="empty">{t('common.loading')}</div>
        ) : (
          <Routes>
            <Route path="/" element={<Navigate to="/chats" replace />} />
            <Route path="/chats/*" element={<ChatsPage />} />
            <Route path="/novel/*" element={<NovelPage />} />
            <Route path="/catalog/:tab?" element={<CatalogPage />} />
            <Route path="/settings/:tab?" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/chats" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
