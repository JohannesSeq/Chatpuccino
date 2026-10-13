import React from 'react';
import { NavLink, Navigate } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import { useT } from '../../i18n.jsx';
import '../../styles/novel-library.css';
import SpritesLibrary from './SpritesLibrary.jsx';

// Lo demás de la biblioteca (estadísticas, fondos…) vive en el Catálogo; estos son accesos directos.
const SHORTCUTS = [
  { to: '/catalog/estadisticas', label: 'library.tabs.stats' },
  { to: '/catalog/fondos', label: 'library.tabs.backgrounds' },
  { to: '/catalog/personajes', label: 'library.shortcuts.characters' },
  { to: '/catalog/lorebooks', label: 'library.shortcuts.lorebooks' },
];

// Biblioteca del Modo Novela: sprites (expresiones y atuendos) y accesos directos al Catálogo. Ruta: /novel/library/:tab?
export default function Library({ tab }) {
  const { t } = useT();
  if (tab === 'stats') return <Navigate to="/catalog/estadisticas" replace />;
  if (tab === 'backgrounds') return <Navigate to="/catalog/fondos" replace />;
  return (
    <div className="library-page">
      <header className="topbar library-head">
        <NavLink to="/novel" className="icon-btn" aria-label={t('library.back_aria')} title={t('library.back')}>
          <Icon name="back" />
        </NavLink>
        <h1>{t('library.title')}</h1>
      </header>
      <nav className="tabs scroll" aria-label={t('library.title')}>
        <NavLink to="/novel/library/sprites" className="active" aria-current="page">
          {t('library.tabs.sprites')}
        </NavLink>
        <span className="tabs-label" aria-hidden="true">
          {t('library.shortcuts.label')}
        </span>
        {SHORTCUTS.map((x) => (
          <NavLink key={x.to} to={x.to} title={t('library.shortcuts.hint')}>
            {t(x.label)} ↗
          </NavLink>
        ))}
      </nav>
      <div className="library-body">
        <SpritesLibrary />
      </div>
    </div>
  );
}
