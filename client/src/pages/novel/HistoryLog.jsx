import React, { useEffect, useRef } from 'react';
import { useT } from '../../i18n.jsx';
import { formatRP } from '../../util.js';
import { Modal } from '../../components/ui.jsx';
import { nameHue } from './vnUtils.js';

const Line = React.memo(function Line({ line, current, mi, li, onJump, refCb }) {
  const { t } = useT();
  const name = line.name || t('novelview.narrator');
  return (
    <button ref={refCb} className={`vn-hist-line ${current ? 'current' : ''} ${line.isUser ? 'user' : ''} ${line.name ? '' : 'narration'}`} onClick={() => onJump(mi, li)}>
      <span className="vn-hist-name" style={line.name ? { color: `hsl(${nameHue(line.name)} 65% var(--sender-l, 72%))` } : undefined}>
        {name}
      </span>
      <span className="vn-hist-text" dangerouslySetInnerHTML={{ __html: formatRP(line.text) }} />
    </button>
  );
});

/** Registro de la historia. Props: beats, cur ({mi, li}), onJump(mi, li), onClose. */
export default function HistoryLog({ beats, cur, onJump, onClose }) {
  const { t } = useT();
  const currentRef = useRef(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, []);
  return (
    <Modal title={t('novelview.history.title')} onClose={onClose} wide>
      {beats.length === 0 ? (
        <div className="empty small">{t('novelview.history.empty')}</div>
      ) : (
        <div className="vn-hist">
          {beats.map((beat, mi) => (
            <section key={beat.index} className="vn-hist-beat">
              {beat.lines.map((line, li) => {
                const current = cur && cur.mi === mi && cur.li === li;
                return <Line key={li} line={line} current={current} mi={mi} li={li} onJump={onJump} refCb={current ? currentRef : undefined} />;
              })}
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
