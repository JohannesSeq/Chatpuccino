import React from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import { useT } from '../../i18n.jsx';
import { useStudio } from '../studio/StudioContext.jsx';
import SettingsPanel from '../studio/SettingsPanel.jsx';
import CharactersPanel from '../studio/CharactersPanel.jsx';
import ExpressionsPanel from '../studio/ExpressionsPanel.jsx';
import BackgroundsPanel from '../studio/BackgroundsPanel.jsx';
import '../../styles/studio.css';

const SECTIONS = [
  { id: 'config', label: 'studio.sections.config', C: SettingsPanel },
  { id: 'personajes', label: 'studio.sections.characters', C: CharactersPanel },
  { id: 'expresiones', label: 'studio.sections.expressions', C: ExpressionsPanel },
  { id: 'fondos', label: 'studio.sections.backgrounds', C: BackgroundsPanel },
];

// Estudio de imágenes (Catálogo → Estudio de imágenes). Ruta: /catalog/estudio/:sub
export default function StudioTab() {
  const { t } = useT();
  const { sub } = useParams();
  const { config, loadError } = useStudio();
  const current = SECTIONS.find((s) => s.id === sub);

  if (!current) {
    if (!config && !loadError) return <p className="muted">{t('common.loading')}</p>;
    return <Navigate to={`/catalog/estudio/${config?.configured ? 'personajes' : 'config'}`} replace />;
  }
  const { C } = current;
  return (
    <div className="stack studio">
      <p className="muted studio-intro">{t('studio.intro')}</p>
      <nav className="tabs scroll studio-tabs" aria-label={t('studio.title')}>
        {SECTIONS.map((s) => (
          <NavLink key={s.id} to={`/catalog/estudio/${s.id}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t(s.label)}
          </NavLink>
        ))}
      </nav>
      {loadError && <p className="err">{loadError}</p>}
      {config ? <C key={current.id} /> : !loadError && <p className="muted">{t('common.loading')}</p>}
    </div>
  );
}
