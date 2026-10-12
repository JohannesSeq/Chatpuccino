import React, { useState } from 'react';
import { useData } from '../../data.jsx';
import { Icon } from '../../components/Icon.jsx';
import PersonaEditor from '../../components/PersonaEditor.jsx';
import { PersonaAvatar } from '../../components/ui.jsx';

export default function PersonasTab() {
  const { personas, settings, refresh } = useData();
  const [editing, setEditing] = useState(null);

  return (
    <div className="stack">
      <p className="muted">Una persona es tu representación en el roleplay: su nombre reemplaza a {'{{user}}'} y su descripción se envía al modelo.</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> Nueva persona
        </button>
      </div>
      <ul className="rows">
        {personas.map((p) => (
          <li key={p.id} className="row">
            <button className="row-main" onClick={() => setEditing(p)}>
              <PersonaAvatar persona={p} />
              <div className="row-text">
                <strong>
                  {p.name} {settings.defaultPersona === p.id && <span className="tag">predeterminada</span>}
                </strong>
                <div className="row-sub">{p.description || 'Sin descripción'}</div>
              </div>
            </button>
          </li>
        ))}
        {!personas.length && <li className="empty small">Aún no hay personas. Sin ninguna, te llamarán «Usuario».</li>}
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
