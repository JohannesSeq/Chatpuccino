import React, { useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useData } from '../../data.jsx';
import { useDialog } from '../../dialogs.jsx';
import { useFileDrop } from '../../useFileDrop.js';
import { loadImage } from '../../util.js';
import { Icon } from '../../components/Icon.jsx';
import { DropOverlay, Field, Lightbox, Modal, SearchBox } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';

const MAX_SIDE = 1920;
const isImage = (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name);
const baseName = (name) => name.replace(/\.[^.]+$/, '').trim() || name;

// Reduce el fondo a 1920 px como máximo y lo guarda como JPEG (sobre blanco si tenía transparencia).
async function prepareBackground(file, t) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('library.backgrounds.process_error')))), 'image/jpeg', 0.88));
}

export default function BackgroundsLibrary() {
  const { t } = useT();
  const { backgrounds, refresh, toast } = useData();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [progress, setProgress] = useState(null); // { done, total }
  const fileRef = useRef(null);
  const editing = backgrounds.find((b) => b.id === editingId) || null;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return backgrounds.filter((b) => !q || b.name.toLowerCase().includes(q) || (b.description || '').toLowerCase().includes(q));
  }, [backgrounds, query]);

  async function handleFiles(files) {
    if (progress) return;
    const images = [];
    for (const f of files) {
      if (isImage(f)) images.push(f);
      else toast(t('library.backgrounds.not_image', { name: f.name }), 'error');
    }
    if (!images.length) return;
    let ok = 0;
    setProgress({ done: 0, total: images.length });
    for (const [i, file] of images.entries()) {
      try {
        const blob = await prepareBackground(file, t);
        await api.uploadBackground(blob, baseName(file.name));
        ok++;
      } catch (err) {
        toast(err.message, 'error');
      }
      setProgress({ done: i + 1, total: images.length });
    }
    setProgress(null);
    if (ok) {
      toast(t('library.backgrounds.uploaded', { count: ok }));
      await refresh('backgrounds', 'worlds');
    }
  }

  const dragging = useFileDrop(handleFiles, !editing && !progress);

  async function onPick(e) {
    const files = [...e.target.files];
    e.target.value = '';
    await handleFiles(files);
  }

  return (
    <div className="stack">
      {dragging && <DropOverlay title={t('library.backgrounds.drop_title')} hint={t('library.backgrounds.drop_hint')} />}
      <p className="muted">{t('library.backgrounds.intro')}</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => fileRef.current.click()} disabled={Boolean(progress)}>
          <Icon name="upload" size={18} />{' '}
          {progress ? t('library.backgrounds.uploading', { done: progress.done, total: progress.total }) : t('library.backgrounds.upload')}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPick} />
      </div>
      {backgrounds.length > 0 && <SearchBox value={query} onChange={setQuery} placeholder={t('library.backgrounds.search')} />}
      {list.length > 0 && (
        <div className="bg-grid">
          {list.map((b) => (
            <button key={b.id} className="bg-card" onClick={() => setEditingId(b.id)}>
              <span className="bg-thumb">
                <img src={b.url} alt="" loading="lazy" />
              </span>
              <strong>{b.name}</strong>
              <small>{b.description || t('library.backgrounds.no_description')}</small>
            </button>
          ))}
        </div>
      )}
      {!list.length && (
        <div className="library-empty">
          <strong>{backgrounds.length ? t('library.backgrounds.no_results') : t('library.backgrounds.empty_title')}</strong>
          {!backgrounds.length && <p className="muted">{t('library.backgrounds.empty_text')}</p>}
        </div>
      )}
      {editing && (
        <BackgroundEditor
          key={editing.id}
          background={editing}
          onClose={async (changed) => {
            setEditingId(null);
            if (changed) await refresh('backgrounds', 'worlds');
          }}
        />
      )}
    </div>
  );
}

function BackgroundEditor({ background, onClose }) {
  const { t } = useT();
  const { toast } = useData();
  const { confirm } = useDialog();
  const [name, setName] = useState(background.name);
  const [description, setDescription] = useState(background.description || '');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);

  async function save() {
    if (!name.trim()) return toast(t('library.backgrounds.editor.name_required'), 'error');
    setBusy(true);
    try {
      await api.updateBackground(background.id, { name: name.trim(), description: description.trim() });
      toast(t('library.backgrounds.editor.saved'));
      onClose(true);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t('library.backgrounds.editor.delete_title'),
      message: t('library.backgrounds.editor.delete_message', { name: background.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteBackground(background.id);
      toast(t('library.backgrounds.editor.deleted'));
      onClose(true);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title={t('library.backgrounds.editor.title')}
        onClose={() => (zoom ? setZoom(false) : onClose(false))}
        footer={
          <>
            <button className="btn danger" onClick={remove} disabled={busy}>
              <Icon name="trash" size={18} /> {t('common.delete')}
            </button>
            <span className="spacer" />
            <button className="btn" onClick={() => onClose(false)} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" onClick={save} disabled={busy}>
              {t('common.save')}
            </button>
          </>
        }
      >
        <button className="bg-preview zoomable" onClick={() => setZoom(true)} aria-label={t('library.backgrounds.editor.preview_aria')} title={t('library.backgrounds.editor.preview_aria')}>
          <img src={background.url} alt={background.name} />
        </button>
        <Field label={t('library.backgrounds.editor.name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label={t('library.backgrounds.editor.description')} hint={t('library.backgrounds.editor.description_hint')}>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('library.backgrounds.editor.description_placeholder')} />
        </Field>
      </Modal>
      {zoom && <Lightbox src={background.url} name={background.name} onClose={() => setZoom(false)} />}
    </>
  );
}
