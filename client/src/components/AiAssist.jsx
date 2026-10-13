import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { assistantGenerate } from '../api.js';
import { Icon } from './Icon.jsx';
import { Modal } from './ui.jsx';

const MODES = [
  ['generate', 'Generar', 'Escribe el texto desde cero'],
  ['improve', 'Mejorar', 'Corrige y enriquece el texto actual'],
  ['expand', 'Expandir', 'Añade más detalle sin quitar nada'],
  ['rewrite', 'Reescribir', 'Dice lo mismo con otras palabras y mejor estilo'],
];

/**
 * Botón ✨ para generar o mejorar el texto de un campo con el Asistente de personajes.
 * `field` es la clave del campo (description, first_mes…); `context` son los demás campos de la ficha.
 */
export function AiButton({ field, label, value, onApply, context }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="icon-btn ai-btn" onClick={() => setOpen(true)} aria-label={`Asistente de IA: ${label}`} title="Asistente de IA: generar o mejorar este texto">
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
  const hasText = Boolean(value.trim());
  const [mode, setMode] = useState(hasText ? 'improve' : 'generate');
  const [instructions, setInstructions] = useState('');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
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
    setResult('');
    try {
      const out = await assistantGenerate({ field, mode, text: value, instructions, context }, ac.signal, (d) => setResult((r) => r + d));
      if (out?.text) setResult(out.text);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message);
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  const needsSetup = error.includes('Asistente de personajes');
  return (
    <Modal
      title={`Asistente: ${label}`}
      onClose={() => {
        abortRef.current?.abort();
        onClose();
      }}
      footer={
        <>
          <span className="spacer" />
          {running ? (
            <button className="btn" onClick={() => abortRef.current?.abort()}>
              Detener
            </button>
          ) : (
            <>
              {result.trim() && (
                <button className="btn primary" onClick={() => onApply(result)}>
                  Usar este texto
                </button>
              )}
              <button className={`btn ${result.trim() ? '' : 'primary'}`} onClick={run}>
                <Icon name="sparkle" size={16} /> {result.trim() ? 'Regenerar' : 'Generar'}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="tabs ai-modes" role="radiogroup" aria-label="Qué hacer">
        {MODES.map(([id, text, hint]) => (
          <button key={id} role="radio" aria-checked={mode === id} className={mode === id ? 'active' : ''} disabled={running || (id !== 'generate' && !hasText)} title={id !== 'generate' && !hasText ? 'El campo está vacío: usa «Generar»' : hint} onClick={() => setMode(id)}>
            {text}
          </button>
        ))}
      </div>
      <p className="muted ai-hint">
        {mode === 'generate' ? (hasText ? 'Escribirá un texto nuevo ignorando el actual.' : 'Escribirá el texto a partir de lo que ya hay en la ficha.') : MODES.find((m) => m[0] === mode)[2] + '.'}
      </p>
      <label className="field">
        <span className="field-label">Indicaciones (opcional)</span>
        <textarea rows={2} value={instructions} disabled={running} onChange={(e) => setInstructions(e.target.value)} placeholder="Ej.: más misteriosa, tono oscuro, que mencione su pasado en la torre…" />
      </label>
      {error && (
        <p className="err">
          {error}
          {needsSetup && (
            <>
              {' '}
              <Link to="/settings/asistente" onClick={onClose}>
                Ir a la configuración
              </Link>
            </>
          )}
        </p>
      )}
      {(running || result) && (
        <label className="field">
          <span className="field-label">{running ? 'Escribiendo…' : 'Resultado (puedes editarlo antes de usarlo)'}</span>
          <textarea className="ai-result" rows={9} value={result} readOnly={running} onChange={(e) => setResult(e.target.value)} />
        </label>
      )}
    </Modal>
  );
}
