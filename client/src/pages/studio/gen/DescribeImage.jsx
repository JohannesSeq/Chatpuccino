import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { assistantDescribeImage, avatarUrl } from '../../../api.js';
import { Icon } from '../../../components/Icon.jsx';
import { useT } from '../../../i18n.jsx';
import { imageToJpegDataUrl } from '../../../util.js';
import { itemSrc } from './helpers.js';

/**
 * «Generar prompt desde la imagen»: describe con el modelo de visión del Asistente la imagen de la tarjeta,
 * una imagen subida o una de la galería. El texto aparece en vivo en una vista previa editable.
 */
export default function DescribeImage({ character, items, onUse }) {
  const { t } = useT();
  const [source, setSource] = useState({ kind: 'card' });
  const [upload, setUpload] = useState(null); // { file, url }
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState({ message: '', setup: false });
  const abortRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => upload && URL.revokeObjectURL(upload.url), [upload]);

  const cardUrl = avatarUrl.character(character);
  const gallery = items.slice(0, 8);
  const selectedItem = source.kind === 'gallery' ? items.find((i) => i.id === source.id) : null;
  const usable = source.kind === 'card' || (source.kind === 'upload' && upload) || selectedItem;

  async function sourceBlob() {
    if (source.kind === 'upload') return upload.file;
    const url = source.kind === 'gallery' ? itemSrc(selectedItem) : cardUrl;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  }

  async function run() {
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setError({ message: '', setup: false });
    setText('');
    try {
      const image = await imageToJpegDataUrl(await sourceBlob(), 1024);
      let acc = '';
      const out = await assistantDescribeImage({ image, name: character.name, purpose: 'sd' }, ac.signal, (d) => {
        acc += d;
        setText(acc);
      });
      if (out?.text) setText(out.text);
    } catch (e) {
      if (e.name !== 'AbortError') setError({ message: e.message, setup: e.code === 'ASSISTANT_NOT_READY' });
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  function pickFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setUpload({ file, url: URL.createObjectURL(file) });
    setSource({ kind: 'upload' });
  }

  return (
    <details className="sg-describe">
      <summary>{t('studio.characters.describe.title')}</summary>
      <p className="field-hint">{t('studio.characters.describe.hint')}</p>
      <span className="field-label">{t('studio.characters.describe.source')}</span>
      <div className="sg-sources" role="radiogroup" aria-label={t('studio.characters.describe.source')}>
        <button type="button" role="radio" aria-checked={source.kind === 'card'} className={`sg-source checker ${source.kind === 'card' ? 'on' : ''}`} onClick={() => setSource({ kind: 'card' })} disabled={running} title={t('studio.characters.describe.card')}>
          <img src={cardUrl} alt={t('studio.characters.describe.card')} />
          <small>{t('studio.characters.describe.card')}</small>
        </button>
        {upload && (
          <button type="button" role="radio" aria-checked={source.kind === 'upload'} className={`sg-source checker ${source.kind === 'upload' ? 'on' : ''}`} onClick={() => setSource({ kind: 'upload' })} disabled={running} title={upload.file.name}>
            <img src={upload.url} alt={upload.file.name} />
            <small>{t('studio.characters.describe.uploaded')}</small>
          </button>
        )}
        {gallery.map((item, i) => (
          <button key={item.id} type="button" role="radio" aria-checked={source.kind === 'gallery' && source.id === item.id} className={`sg-source checker ${source.kind === 'gallery' && source.id === item.id ? 'on' : ''}`} onClick={() => setSource({ kind: 'gallery', id: item.id })} disabled={running}>
            <img src={itemSrc(item)} alt={t('studio.characters.describe.generated', { n: i + 1 })} />
            <small>{t('studio.characters.describe.generated', { n: i + 1 })}</small>
          </button>
        ))}
        <button type="button" className="sg-source sg-source-add" onClick={() => fileRef.current?.click()} disabled={running}>
          <Icon name="upload" size={20} />
          <small>{t('studio.characters.describe.upload')}</small>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} />
      </div>
      <div className="btn-row">
        {running ? (
          <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
            {t('common.stop')}
          </button>
        ) : (
          <button type="button" className="btn" onClick={run} disabled={!usable}>
            <Icon name="sparkle" size={16} /> {t('studio.characters.describe.run')}
          </button>
        )}
      </div>
      {error.message && (
        <p className="err" role="alert">
          {error.message}{' '}
          {error.setup && (
            <>
              {t('studio.characters.describe.needs_vision')}{' '}
              <Link to="/settings/asistente">{t('studio.characters.describe.go_assistant')}</Link>
            </>
          )}
        </p>
      )}
      {(running || text) && (
        <div className="field">
          <span className="field-label">{running ? t('studio.characters.describe.writing') : t('studio.characters.describe.result')}</span>
          <textarea rows={5} value={text} readOnly={running} onChange={(e) => setText(e.target.value)} aria-label={t('studio.characters.describe.result')} />
          {!running && (
            <div className="btn-row">
              <button type="button" className="btn primary small" onClick={() => onUse(text, 'replace')} disabled={!text.trim()}>
                {t('studio.characters.describe.replace')}
              </button>
              <button type="button" className="btn small" onClick={() => onUse(text, 'append')} disabled={!text.trim()}>
                {t('studio.characters.describe.append')}
              </button>
              <button type="button" className="btn small" onClick={() => setText('')}>
                {t('studio.characters.describe.discard')}
              </button>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
