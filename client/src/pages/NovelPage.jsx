import React, { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useMatch, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useData } from '../data.jsx';
import { useDialog } from '../dialogs.jsx';
import { useT } from '../i18n.jsx';
import { formatListDate } from '../util.js';
import { Icon } from '../components/Icon.jsx';
import { CharAvatar, Menu, SearchBox } from '../components/ui.jsx';
import PasswordBanner from '../components/PasswordBanner.jsx';
import WorldEditor from '../components/novel/WorldEditor.jsx';
import Library from './novel/Library.jsx';
import NovelView from './novel/NovelView.jsx';
import '../styles/novel-list.css';

export default function NovelPage() {
  const home = useMatch('/novel');
  const worldMatch = useMatch('/novel/:worldId');
  const { refresh } = useData();
  useEffect(() => {
    refresh('worlds');
  }, [refresh]);
  const activeId = worldMatch && worldMatch.params.worldId !== 'library' ? worldMatch.params.worldId : null;
  return (
    <div className={`chats-page novel-page ${home ? '' : 'has-pane'} ${activeId ? 'in-world' : ''}`}>
      <WorldList activeId={activeId} />
      <section className="chat-pane novel-pane">
        <Routes>
          <Route index element={<NovelHint />} />
          <Route path="library/:tab?" element={<LibraryRoute />} />
          <Route path=":worldId" element={<WorldRoute />} />
        </Routes>
      </section>
    </div>
  );
}

function NovelHint() {
  const { t } = useT();
  return (
    <div className="empty">
      <Icon name="book" size={64} />
      <p>{t('novel.empty_select')}</p>
    </div>
  );
}

function LibraryRoute() {
  const { tab } = useParams();
  return <Library tab={tab} />;
}

function WorldRoute() {
  const { worldId } = useParams();
  const navigate = useNavigate();
  return <NovelView key={worldId} worldId={worldId} onExit={() => navigate('/novel')} />;
}

function WorldList({ activeId }) {
  const { worlds, characters, stats, backgrounds, charById, refresh, toast } = useData();
  const { confirm } = useDialog();
  const { t } = useT();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | world (elemento de la lista)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return worlds;
    return worlds.filter((w) => w.name.toLowerCase().includes(q) || (w.lastLine?.text || '').toLowerCase().includes(q) || (w.description || '').toLowerCase().includes(q));
  }, [worlds, query]);

  async function duplicate(w) {
    try {
      const copy = await api.copyWorld(w.id);
      await refresh('worlds');
      toast(t('novel.duplicated'));
      if (copy?.id) navigate(`/novel/${encodeURIComponent(copy.id)}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function remove(w) {
    if (!(await confirm({ title: t('novel.delete_title'), message: t('novel.delete_message', { name: w.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    try {
      await api.deleteWorld(w.id);
      await refresh('worlds');
      if (activeId === w.id) navigate('/novel');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function afterEditor(result) {
    setEditing(null);
    if (!result?.changed) return;
    refresh('worlds');
    if (result.deleted && result.id === activeId) navigate('/novel');
    else if (result.created && result.id) navigate(`/novel/${encodeURIComponent(result.id)}`);
  }

  const missing = [
    !characters.length && { key: 'characters', to: '/catalog/personajes', label: t('novel.hint.need_characters') },
    !backgrounds.length && { key: 'backgrounds', to: '/catalog/fondos', label: t('novel.hint.need_backgrounds') },
    !stats.length && { key: 'stats', to: '/catalog/estadisticas', label: t('novel.hint.need_stats') },
  ].filter(Boolean);

  return (
    <aside className="chat-list novel-list">
      <header className="topbar head-row">
        <h1>{t('novel.title')}</h1>
        <Link to="/novel/library/sprites" className="icon-btn" aria-label={t('novel.library_aria')} title={t('novel.library_title')}>
          <Icon name="tune" />
        </Link>
      </header>
      <PasswordBanner />
      {worlds.length > 0 && (
        <div className="pad-x">
          <SearchBox value={query} onChange={setQuery} placeholder={t('novel.search_placeholder')} />
        </div>
      )}
      <ul className="rows">
        {rows.map((w) => {
          const isActive = w.id === activeId;
          const cast = (w.characters || []).map((id) => charById[id]).filter(Boolean);
          const line = w.lastLine ? `${w.lastLine.speaker ? `${w.lastLine.speaker}: ` : ''}${String(w.lastLine.text || '').replace(/\*+/g, '')}` : t('novel.last_line.none');
          return (
            <li key={w.id} className={`row ${isActive ? 'active' : ''}`}>
              <button className="row-main" onClick={() => navigate(`/novel/${encodeURIComponent(w.id)}`)}>
                <WorldThumb world={w} />
                <div className="row-text">
                  <div className="row-top">
                    <strong>{w.name}</strong>
                    <time>{w.updatedAt ? formatListDate(w.updatedAt) : ''}</time>
                  </div>
                  <div className="row-sub">{line}</div>
                  {cast.length > 0 && (
                    <div className="world-cast" aria-label={t('novel.cast_aria', { names: cast.map((c) => c.name).join(', ') })}>
                      {cast.slice(0, 5).map((c) => (
                        <CharAvatar key={c.id} character={c} size={22} />
                      ))}
                      {cast.length > 5 && <span className="world-cast-more">+{cast.length - 5}</span>}
                    </div>
                  )}
                </div>
              </button>
              <Menu
                items={[
                  { label: t('common.edit'), onClick: () => setEditing(w) },
                  { label: t('common.duplicate'), onClick: () => duplicate(w) },
                  { label: t('common.delete'), danger: true, onClick: () => remove(w) },
                ]}
              />
            </li>
          );
        })}
        {!worlds.length && (
          <li className="novel-empty">
            <Icon name="book" size={44} />
            <strong>{t('novel.empty_title')}</strong>
            <p>{t('novel.empty_text')}</p>
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Icon name="plus" size={18} /> {t('novel.new_world')}
            </button>
            {missing.length > 0 && (
              <ul className="novel-hints">
                {missing.map((m) => (
                  <li key={m.key}>
                    <Link to={m.to}>{m.label}</Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
        {worlds.length > 0 && !rows.length && <li className="empty small">{t('novel.empty_no_results')}</li>}
      </ul>
      <button className="fab" onClick={() => setEditing('new')} aria-label={t('novel.new_world')} title={t('novel.new_world')}>
        <Icon name="plus" size={28} />
      </button>
      {editing && <WorldEditor world={editing === 'new' ? null : editing} onClose={afterEditor} />}
    </aside>
  );
}

function WorldThumb({ world }) {
  const [failed, setFailed] = useState(false);
  const url = world.background?.url;
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) return <img className="world-thumb" src={url} alt="" loading="lazy" onError={() => setFailed(true)} />;
  let h = 0;
  for (const ch of world.name || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return (
    <div className="world-thumb placeholder" style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 34%), hsl(${(hue + 50) % 360} 50% 22%))` }} aria-hidden="true">
      {(world.name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}
