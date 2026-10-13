import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { assistantGenerate } from '../api.js';
import { Icon } from './Icon.jsx';
import { Modal } from './ui.jsx';
import { useT } from '../i18n.jsx';

const MODES = ['generate', 'improve', 'expand', 'rewrite'];

/**
 * Botón ✨ para generar o mejorar el texto de un campo con el Asistente de personajes.
 * `field` es la clave del campo (description, first_mes…); `context` son los demás campos de la ficha.
 */
export function AiButton({ field, label, value, onApply, context }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="icon-btn ai-btn" onClick={() => setOpen(true)} aria-label={t('ai_assist.button_aria', { label })} title={t('ai_assist.button_title')}>
        <Icon name="sparkle" size={18} />
      </button>
      {open &&
        createPortal(
          <AssistModal
            field={field}
            label={label}
            value={value || ''}
            context={context}
            onApply={(text) => {
              onApply(text);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}

function AssistModal({ field, label, value, context, onApply, onClose }) {
  const { t } = useT();
  const hasText = Boolean(value.trim());
  const [mode, setMode] = useState(hasText ? 'improve' : 'generate');
  const [instructions, setInstructions] = useState('');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);
  const abortRef = useRef(null);

  // Esc cierra solo esta ventana (y no la que pudiera haber debajo, como la tarjeta abierta desde el chat).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (running) abortRef.current?.abort();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [running, onClose]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run() {
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setError('');
    setNeedsSetup(false);
    setResult('');
    try {
      const out = await assistantGenerate({ field, mode, text: value, instructions, context }, ac.signal, (d) => setResult((r) => r + d));
      if (out?.text) setResult(out.text);
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(e.message);
        setNeedsSetup(e.code === 'ASSISTANT_NOT_READY');
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  return (
    <Modal
      title={t('ai_assist.modal_title', { label })}
      onClose={() => {
        abortRef.current?.abort();
        onClose();
      }}
      footer={
        <>
          <span className="spacer" />
          {running ? (
            <button className="btn" onClick={() => abortRef.current?.abort()}>
              {t('common.stop')}
            </button>
          ) : (
            <>
              {result.trim() && (
                <button className="btn primary" onClick={() => onApply(result)}>
                  {t('ai_assist.use_text')}
                </button>
              )}
              <button className={`btn ${result.trim() ? '' : 'primary'}`} onClick={run}>
                <Icon name="sparkle" size={16} /> {result.trim() ? t('ai_assist.regenerate') : t('ai_assist.modes.generate')}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="tabs ai-modes" role="radiogroup" aria-label={t('ai_assist.modes_aria')}>
        {MODES.map((id) => (
          <button key={id} role="radio" aria-checked={mode === id} className={mode === id ? 'active' : ''} disabled={running || (id !== 'generate' && !hasText)} title={id !== 'generate' && !hasText ? t('ai_assist.empty_field') : t(`ai_assist.hints.${id}`)} onClick={() => setMode(id)}>
            {t(`ai_assist.modes.${id}`)}
          </button>
        ))}
      </div>
      <p className="muted ai-hint">
        {mode === 'generate' ? (hasText ? t('ai_assist.generate_replace') : t('ai_assist.generate_from_card')) : t(`ai_assist.hints.${mode}`) + '.'}
      </p>
      <label className="field">
        <span className="field-label">{t('ai_assist.instructions_label')}</span>
        <textarea rows={2} value={instructions} disabled={running} onChange={(e) => setInstructions(e.target.value)} placeholder={t('ai_assist.instructions_placeholder')} />
      </label>
      {error && (
        <p className="err">
          {error}
          {needsSetup && (
            <>
              {' '}
              <Link to="/settings/asistente" onClick={onClose}>
                {t('ai_assist.go_settings')}
              </Link>
            </>
          )}
        </p>
      )}
      {(running || result) && (
        <label className="field">
          <span className="field-label">{running ? t('ai_assist.writing') : t('ai_assist.result_label')}</span>
          <textarea className="ai-result" rows={9} value={result} readOnly={running} onChange={(e) => setResult(e.target.value)} />
        </label>
      )}
    </Modal>
  );
}
