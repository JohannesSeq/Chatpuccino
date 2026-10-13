import React from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import { useT } from '../../i18n.jsx';
import '../../styles/novel-library.css';
import BackgroundsLibrary from './BackgroundsLibrary.jsx';
import SpritesLibrary from './SpritesLibrary.jsx';
import StatsLibrary from './StatsLibrary.jsx';

const TABS = [
  { id: 'stats', label: 'library.tabs.stats', C: StatsLibrary },
  { id: 'backgrounds', label: 'library.tabs.backgrounds', C: BackgroundsLibrary },
  { id: 'sprites', label: 'library.tabs.sprites', C: SpritesLibrary },
];

// Biblioteca global del Modo Novela: estadísticas, fondos y sprites. Ruta: /novel/library/:tab?
export default function Library({ tab }) {
  const { t } = useT();
  const current = TABS.find((x) => x.id === tab) || TABS[0];
  const { C } = current;
  return (
    <div className="library-page">
      <header className="topbar library-head">
        <NavLink to="/novel" className="icon-btn" aria-label={t('library.back_aria')} title={t('library.back')}>
          <Icon name="back" />
        </NavLink>
        <h1>{t('library.title')}</h1>
      </header>
      <nav className="tabs scroll" aria-label={t('library.title')}>
        {TABS.map((x) => (
          <NavLink key={x.id} to={`/novel/library/${x.id}`} className={x.id === current.id ? 'active' : ''} aria-current={x.id === current.id ? 'page' : undefined}>
            {t(x.label)}
          </NavLink>
        ))}
      </nav>
      <div className="library-body">
        <C />
      </div>
    </div>
  );
}
