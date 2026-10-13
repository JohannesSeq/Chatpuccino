import React from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import ConnectionTab from './settings/ConnectionTab.jsx';
import SecurityTab from './settings/SecurityTab.jsx';
import PresetsTab from './settings/PresetsTab.jsx';
import AssistantTab from './settings/AssistantTab.jsx';
import AppearanceTab from './settings/AppearanceTab.jsx';
import PasswordBanner from '../components/PasswordBanner.jsx';
import { useT } from '../i18n.jsx';

const TABS = [
  { id: 'conexion', label: 'settings.tabs.connection', C: ConnectionTab },
  { id: 'presets', label: 'settings.tabs.presets', C: PresetsTab },
  { id: 'asistente', label: 'settings.tabs.assistant', C: AssistantTab },
  { id: 'apariencia', label: 'settings.tabs.appearance', C: AppearanceTab },
  { id: 'seguridad', label: 'settings.tabs.security', C: SecurityTab },
];

// Pestañas que ahora viven en el Catálogo (enlaces y marcadores antiguos).
const MOVED = new Set(['personajes', 'personas', 'lorebooks']);

export default function SettingsPage() {
  const { t } = useT();
  const { tab } = useParams();
  if (MOVED.has(tab)) return <Navigate to={`/catalog/${tab}`} replace />;
  const current = TABS.find((x) => x.id === tab);
  if (!current) return <Navigate to="/settings/conexion" replace />;
  const { C } = current;
  return (
    <div className="settings-page">
      <header className="topbar">
        <h1>{t('settings.title')}</h1>
      </header>
      <PasswordBanner />
      <div className="tabs scroll">
        {TABS.map((x) => (
          <NavLink key={x.id} to={`/settings/${x.id}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t(x.label)}
          </NavLink>
        ))}
      </div>
      <div className="settings-body">
        <C />
      </div>
    </div>
  );
}
