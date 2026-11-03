import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { useT } from '../../i18n.jsx';
import { Icon } from '../Icon.jsx';
import { Menu, Modal } from '../ui.jsx';

const missingCount = (m) => (m ? m.characters.length + m.lorebooks.length + m.statIds.length + (m.background ? 1 : 0) : 0);
const missingList = (m) => [...m.characters, ...m.lorebooks, ...m.statIds, ...(m.background ? [m.background] : [])];

// Gestor de plantillas de mundos: crear un mundo a partir de una, renombrar, exportar, importar y eliminar.
// onUse(template): el usuario quiere crear un mundo con esa plantilla. onClose(): cerrar.
export default function TemplatesDialog({ onClose, onUse }) {
  const { refresh, toast } = useData();
  const { confirm, prompt } = useDialog();
  const { t } = useT();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setList(await api.worldTemplates());
    } catch (e) {
      toast(e.message, 'error');
      setList([]);
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  async function rename(tpl) {
    const name = await prompt({ title: t('templates.rename_title'), label: t('templates.name_label'), defaultValue: tpl.name, confirmLabel: t('common.rename') });
    if (name === null || !name.trim() || name.trim() === tpl.name) return;
    try {
      await api.updateWorldTemplate(tpl.id, { name: name.trim() });
      await load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function remove(tpl) {
    if (!(await confirm({ title: t('templates.delete_title'), message: t('templates.delete_message', { name: tpl.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    try {
      await api.deleteWorldTemplate(tpl.id);
      await load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function onImport(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of files) {
      try {
        const res = await api.importWorldTemplate(JSON.parse(await f.text()));
        ok++;
        const extra = [res.created.stats ? t('templates.import_stats', { count: res.created.stats }) : '', res.created.lorebooks ? t('templates.import_books', { count: res.created.lorebooks }) : ''].filter(Boolean).join(', ');
        toast(t('templates.imported', { name: res.template.name }) + (extra ? ` (${extra})` : ''));
      } catch (err) {
        toast(err instanceof SyntaxError ? t('templates.invalid_json', { name: f.name }) : `${f.name}: ${err.message}`, 'error');
      }
    }
    if (ok) await Promise.all([load(), refresh('stats', 'lorebooks')]);
    setBusy(false);
  }

  return (
    <Modal wide title={t('templates.title')} onClose={onClose}>
      <p className="muted">{t('templates.intro')}</p>
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={18} /> {t('templates.import')}
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden onChange={onImport} />
      </div>
      {list === null ? (
        <div className="empty small">{t('common.loading')}</div>
      ) : list.length === 0 ? (
        <div className="empty small">{t('templates.empty')}</div>
      ) : (
        <ul className="rows tpl-list">
          {list.map((tpl) => {
            const missing = missingCount(tpl.missing);
            return (
              <li key={tpl.id} className="row tpl-row">
                <div className="row-main tpl-main">
                  <div className="row-text">
                    <strong>{tpl.name}</strong>
                    <div className="row-sub">{tpl.description.trim() ? tpl.description.replace(/\s+/g, ' ').slice(0, 140) : t('templates.no_premise')}</div>
                    <div className="row-sub">
                      {t('templates.summary', { characters: tpl.characters.length, stats: tpl.statIds.length, lorebooks: tpl.lorebooks.length })}
                      {tpl.classic ? ` · ${t('novelview.classic.label')}` : ''}
                    </div>
                    {missing > 0 && (
                      <div className="tpl-missing" title={missingList(tpl.missing).join(', ')}>
                        {t('templates.missing_row', { count: missing, list: missingList(tpl.missing).slice(0, 4).join(', ') + (missing > 4 ? '…' : '') })}
                      </div>
                    )}
                  </div>
                </div>
                <button className="btn small primary" onClick={() => onUse(tpl)}>
                  {t('templates.use')}
                </button>
                <Menu
                  items={[
                    { label: t('common.rename'), onClick: () => rename(tpl) },
                    { label: t('templates.export'), href: `/api/world-templates/${encodeURIComponent(tpl.id)}/export`, download: `${tpl.name}.world.json` },
                    { label: t('common.delete'), danger: true, onClick: () => remove(tpl) },
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
