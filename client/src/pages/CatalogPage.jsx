import React from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import CharactersTab from './catalog/CharactersTab.jsx';
import PersonasTab from './catalog/PersonasTab.jsx';
import TagsTab from './catalog/TagsTab.jsx';
import LorebooksTab from './catalog/LorebooksTab.jsx';
import BackgroundsLibrary from './novel/BackgroundsLibrary.jsx';
import StatsLibrary from './novel/StatsLibrary.jsx';
import PasswordBanner from '../components/PasswordBanner.jsx';
import { useT } from '../i18n.jsx';
import '../styles/novel-library.css';

// `wide`: las bibliotecas de la novela usan el ancho y los márgenes de su propia hoja de estilos.
const TABS = [
  { id: 'personajes', label: 'catalog.tabs.characters', C: CharactersTab },
  { id: 'personas', label: 'catalog.tabs.personas', C: PersonasTab },
  { id: 'etiquetas', label: 'catalog.tabs.tags', C: TagsTab },
  { id: 'lorebooks', label: 'catalog.tabs.lorebooks', C: LorebooksTab },
  { id: 'fondos', label: 'catalog.tabs.backgrounds', C: BackgroundsLibrary, wide: true },
  { id: 'estadisticas', label: 'catalog.tabs.stats', C: StatsLibrary, wide: true },
];

// Catálogo: todo lo que se crea y se reutiliza (personajes, personas, etiquetas, lorebooks, fondos y estadísticas). Ruta: /catalog/:tab?
export default function CatalogPage() {
  const { t } = useT();
  const { tab } = useParams();
  const current = TABS.find((x) => x.id === tab);
  if (!current) return <Navigate to="/catalog/personajes" replace />;
  const { C } = current;
  return (
    <div className="settings-page catalog-page">
      <header className="topbar">
        <h1>{t('catalog.title')}</h1>
      </header>
      <PasswordBanner />
      <div className="tabs scroll">
        {TABS.map((x) => (
          <NavLink key={x.id} to={`/catalog/${x.id}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t(x.label)}
          </NavLink>
        ))}
      </div>
      <div className={current.wide ? 'library-body' : 'settings-body'}>
        <C />
      </div>
    </div>
  );
}
