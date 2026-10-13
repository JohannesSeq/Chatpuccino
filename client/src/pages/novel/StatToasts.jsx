import React, { useEffect } from 'react';
import { useT } from '../../i18n.jsx';
import { Icon } from '../../components/Icon.jsx';
import { VnIcon, fmtDelta, fmtNum } from './vnUtils.js';

const LIFETIME = 5000;

function StatCard({ item, stats, worldName, onDismiss }) {
  const { t } = useT();
  const { change } = item;
  const stat = stats.find((s) => s.id === change.stat);
  const color = stat?.color || 'var(--accent)';
  const up = change.delta >= 0;
  const who = change.scope === 'world' || !change.character ? worldName : change.characterName || change.character;

  useEffect(() => {
    const id = setTimeout(() => onDismiss(item.id), LIFETIME);
    return () => clearTimeout(id);
  }, [item.id, onDismiss]);

  return (
    <div className="vn-stat-card" style={{ '--stat-color': color }}>
      <span className={`vn-stat-arrow ${up ? 'up' : 'down'}`} aria-hidden="true">
        <VnIcon name="caret" size={20} />
      </span>
      <div className="vn-stat-card-text">
        <strong>{t('novelview.toasts.stat_line', { who, stat: change.statName || stat?.name || change.stat, delta: fmtDelta(change.delta), from: fmtNum(change.from), to: fmtNum(change.to) })}</strong>
        {change.reason && <span>{change.reason}</span>}
      </div>
      <button className="icon-btn" onClick={() => onDismiss(item.id)} aria-label={t('common.close')}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

/** Notificaciones emergentes de cambios de estadísticas. Props: items [{id, change}], stats, worldName, onDismiss(id). */
export default function StatToasts({ items, stats, worldName, onDismiss }) {
  return (
    <div className="vn-stat-toasts" role="status" aria-live="polite" aria-relevant="additions">
      {items.map((item) => (
        <StatCard key={item.id} item={item} stats={stats} worldName={worldName} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
