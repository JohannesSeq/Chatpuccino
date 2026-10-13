import React, { useState } from 'react';
import { useData } from '../../data.jsx';
import { Icon } from '../../components/Icon.jsx';
import PersonaEditor from '../../components/PersonaEditor.jsx';
import { PersonaAvatar } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';

export default function PersonasTab() {
  const { t } = useT();
  const { personas, settings, refresh } = useData();
  const [editing, setEditing] = useState(null);

  return (
    <div className="stack">
      <p className="muted">{t('personas.intro')}</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> {t('personas.new')}
        </button>
      </div>
      <ul className="rows">
        {personas.map((p) => (
          <li key={p.id} className="row">
            <button className="row-main" onClick={() => setEditing(p)}>
              <PersonaAvatar persona={p} />
              <div className="row-text">
                <strong>
                  {p.name} {settings.defaultPersona === p.id && <span className="tag">{t('personas.default_tag')}</span>}
                </strong>
                <div className="row-sub">{p.description || t('personas.no_description')}</div>
              </div>
            </button>
          </li>
        ))}
        {!personas.length && <li className="empty small">{t('personas.empty')}</li>}
      </ul>
      {editing && (
        <PersonaEditor
          persona={editing === 'new' ? null : editing}
          onClose={async (changed) => {
            setEditing(null);
            if (changed) await refresh('personas', 'settings');
          }}
        />
      )}
    </div>
  );
}
