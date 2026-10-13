import React, { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { Icon } from '../../components/Icon.jsx';
import { SearchBox } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';

const sameTag = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Etiquetas de los personajes: ver cuántos personajes usa cada una, renombrarlas (o fusionarlas) y quitarlas de todos.
export default function TagsTab() {
  const { t } = useT();
  const { characters, refresh, toast } = useData();
  const { confirm, prompt } = useDialog();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const tags = useMemo(() => {
    const map = new Map();
    for (const c of characters) {
      for (const tag of c.tags || []) {
        const key = tag.trim().toLowerCase();
        if (!key) continue;
        const entry = map.get(key) || { name: tag, characters: [] };
        entry.characters.push(c);
        map.set(key, entry);
      }
    }
    return [...map.values()].sort((a, b) => b.characters.length - a.characters.length || a.name.localeCompare(b.name));
  }, [characters]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tags.filter((x) => !q || x.name.toLowerCase().includes(q));
  }, [tags, query]);

  // Cambia las etiquetas de cada personaje afectado: `next(tags)` devuelve la lista nueva.
  async function rewrite(entry, next) {
    setBusy(true);
    let failed = 0;
    for (const c of entry.characters) {
      try {
        const { data } = await api.character(c.id);
        await api.updateCharacter(c.id, { ...data, tags: next(data.tags || []) });
      } catch {
        failed += 1;
      }
    }
    await refresh('characters');
    setBusy(false);
    return failed;
  }

  async function rename(entry) {
    const value = await prompt({
      title: t('tags_tab.rename_title'),
      message: t('tags_tab.rename_message', { name: entry.name }),
      label: t('tags_tab.name_label'),
      defaultValue: entry.name,
      confirmLabel: t('tags_tab.rename'),
    });
    const name = value?.trim();
    if (!name || name === entry.name) return;
    const merges = tags.some((x) => x !== entry && sameTag(x.name, name));
    const failed = await rewrite(entry, (list) => {
      const out = [];
      for (const tag of list) {
        const mapped = sameTag(tag, entry.name) ? name : tag;
        if (!out.some((x) => sameTag(x, mapped))) out.push(mapped);
      }
      return out;
    });
    toast(failed ? t('tags_tab.partial', { count: failed }) : merges ? t('tags_tab.merged', { name }) : t('tags_tab.renamed', { name }), failed ? 'error' : undefined);
  }

  async function remove(entry) {
    const ok = await confirm({
      title: t('tags_tab.delete_title'),
      message: t('tags_tab.delete_message', { name: entry.name, count: entry.characters.length }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    const failed = await rewrite(entry, (list) => list.filter((tag) => !sameTag(tag, entry.name)));
    toast(failed ? t('tags_tab.partial', { count: failed }) : t('tags_tab.deleted', { name: entry.name }), failed ? 'error' : undefined);
  }

  return (
    <div className="stack">
      <p className="muted">{t('tags_tab.intro')}</p>
      {tags.length > 0 && <SearchBox value={query} onChange={setQuery} placeholder={t('tags_tab.search')} />}
      <ul className="rows">
        {rows.map((x) => (
          <li key={x.name.toLowerCase()} className="row">
            <div className="row-main">
              <div className="row-text">
                <strong>
                  <span className="tag">{x.name}</span>
                </strong>
                <div className="row-sub">
                  {t('tags_tab.used_by', { count: x.characters.length })}: {x.characters.slice(0, 4).map((c) => c.name).join(', ')}
                  {x.characters.length > 4 ? '…' : ''}
                </div>
              </div>
            </div>
            <button className="icon-btn" onClick={() => rename(x)} disabled={busy} aria-label={t('tags_tab.rename_aria', { name: x.name })} title={t('tags_tab.rename')}>
              <Icon name="edit" size={20} />
            </button>
            <button className="icon-btn" onClick={() => remove(x)} disabled={busy} aria-label={t('tags_tab.delete_aria', { name: x.name })} title={t('common.delete')}>
              <Icon name="trash" size={20} />
            </button>
          </li>
        ))}
        {!tags.length && <li className="empty small">{t('tags_tab.empty')}</li>}
        {tags.length > 0 && !rows.length && <li className="empty small">{t('tags_tab.no_results')}</li>}
      </ul>
    </div>
  );
}
