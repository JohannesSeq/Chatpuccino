import React from 'react';
import { Link, NavLink, Navigate } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import { useT } from '../../i18n.jsx';
import '../../styles/novel-library.css';

// Todo vive en el Catálogo; esta página es un acceso rápido desde la novela.
const ITEMS = [
  { id: 'sprites', to: '/catalog/sprites', icon: 'image' },
  { id: 'stats', to: '/catalog/estadisticas', icon: 'tune' },
  { id: 'backgrounds', to: '/catalog/fondos', icon: 'image' },
  { id: 'characters', to: '/catalog/personajes', icon: 'group' },
  { id: 'lorebooks', to: '/catalog/lorebooks', icon: 'book' },
];

// Ruta: /novel/library/:tab? (los enlaces antiguos con pestaña van directo a su sección del Catálogo).
const LEGACY = { sprites: 'sprites', stats: 'estadisticas', backgrounds: 'fondos' };

export default function Library({ tab }) {
  const { t } = useT();
  if (LEGACY[tab]) return <Navigate to={`/catalog/${LEGACY[tab]}`} replace />;
  return (
    <div className="library-page">
      <header className="topbar library-head">
        <NavLink to="/novel" className="icon-btn" aria-label={t('library.back_aria')} title={t('library.back')}>
          <Icon name="back" />
        </NavLink>
        <h1>{t('library.title')}</h1>
      </header>
      <div className="library-body">
        <p className="muted">{t('library.hub.intro')}</p>
        <ul className="rows">
          {ITEMS.map((x) => (
            <li key={x.id} className="row">
              <Link className="row-main" to={x.to}>
                <Icon name={x.icon} size={26} />
                <div className="row-text">
                  <strong>{t(`library.hub.${x.id}.title`)}</strong>
                  <div className="row-sub">{t(`library.hub.${x.id}.text`)}</div>
                </div>
                <Icon name="right" size={22} />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
