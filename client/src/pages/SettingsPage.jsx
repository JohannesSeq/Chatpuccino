import React from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import ConnectionTab from './settings/ConnectionTab.jsx';
import CharactersTab from './settings/CharactersTab.jsx';
import PersonasTab from './settings/PersonasTab.jsx';
import LorebooksTab from './settings/LorebooksTab.jsx';
import SecurityTab from './settings/SecurityTab.jsx';
import PresetsTab from './settings/PresetsTab.jsx';
import AppearanceTab from './settings/AppearanceTab.jsx';
import PasswordBanner from '../components/PasswordBanner.jsx';

const TABS = [
  { id: 'conexion', label: 'Conexión y modelo', C: ConnectionTab },
  { id: 'presets', label: 'Presets', C: PresetsTab },
  { id: 'apariencia', label: 'Apariencia', C: AppearanceTab },
  { id: 'personajes', label: 'Personajes', C: CharactersTab },
  { id: 'personas', label: 'Personas', C: PersonasTab },
  { id: 'lorebooks', label: 'Lorebooks', C: LorebooksTab },
  { id: 'seguridad', label: 'Seguridad', C: SecurityTab },
];

export default function SettingsPage() {
  const { tab } = useParams();
  const current = TABS.find((t) => t.id === tab);
  if (!current) return <Navigate to="/settings/conexion" replace />;
  const { C } = current;
  return (
    <div className="settings-page">
      <header className="topbar">
        <h1>Ajustes</h1>
      </header>
      <PasswordBanner />
      <div className="tabs scroll">
        {TABS.map((t) => (
          <NavLink key={t.id} to={`/settings/${t.id}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <div className="settings-body">
        <C />
      </div>
    </div>
  );
}
