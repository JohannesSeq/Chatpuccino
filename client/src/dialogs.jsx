import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const Ctx = createContext(null);

/**
 * confirm({ title, message, confirmLabel, danger }) -> Promise<boolean>
 * prompt({ title, message, label, defaultValue, placeholder, confirmLabel, allowEmpty, multiline, validate }) -> Promise<string | null>
 */
export const useDialog = () => useContext(Ctx);

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const current = useRef(null);

  const finish = useCallback((value) => {
    const d = current.current;
    current.current = null;
    setDialog(null);
    d?.resolve(value);
  }, []);

  const open = useCallback((spec) => {
    const cancelled = current.current;
    current.current = null;
    cancelled?.resolve(cancelled.kind === 'confirm' ? false : null);
    return new Promise((resolve) => {
      const d = { ...spec, resolve };
      current.current = d;
      setDialog(d);
    });
  }, []);

  const api = useMemo(
    () => ({
      confirm: (o) => open({ kind: 'confirm', ...o }),
      prompt: (o) => open({ kind: 'prompt', ...o }),
    }),
    [open],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {dialog && <DialogView key={dialog.title + dialog.kind} dialog={dialog} onFinish={finish} />}
    </Ctx.Provider>
  );
}

function DialogView({ dialog, onFinish }) {
  const isPrompt = dialog.kind === 'prompt';
  const cancelValue = isPrompt ? null : false;
  const [value, setValue] = useState(dialog.defaultValue || '');
  const [touched, setTouched] = useState(false);
  const fieldRef = useRef(null);

  // Captura Escape antes que cualquier modal que haya debajo para cerrar solo este diálogo.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onFinish(cancelValue);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onFinish, cancelValue]);

  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select?.();
  }, []);

  const trimmed = value.trim();
  const error = isPrompt ? (!trimmed && !dialog.allowEmpty ? 'Escribe un valor' : dialog.validate?.(trimmed) || '') : '';

  function submit(e) {
    e.preventDefault();
    if (isPrompt) {
      setTouched(true);
      if (error) return;
      onFinish(trimmed);
    } else {
      onFinish(true);
    }
  }

  const Field = dialog.multiline ? 'textarea' : 'input';
  return (
    <div className="overlay dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onFinish(cancelValue)}>
      <form className="sheet dialog" role="dialog" aria-label={dialog.title} onSubmit={submit}>
        <div className="sheet-body">
          <h2>{dialog.title}</h2>
          {dialog.message && <p className="muted dialog-message">{dialog.message}</p>}
          {isPrompt && (
            <label className="field">
              {dialog.label && <span className="field-label">{dialog.label}</span>}
              <Field
                ref={fieldRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={dialog.placeholder}
                rows={dialog.multiline ? 4 : undefined}
                autoComplete="off"
                autoCapitalize="none"
              />
              {touched && error && <span className="field-error">{error}</span>}
            </label>
          )}
        </div>
        <footer className="sheet-foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => onFinish(cancelValue)}>
            {dialog.cancelLabel || 'Cancelar'}
          </button>
          <button
            type="submit"
            ref={isPrompt ? undefined : fieldRef}
            className={`btn ${dialog.danger ? 'danger-fill' : 'primary'}`}
            disabled={isPrompt && touched && Boolean(error)}
          >
            {dialog.confirmLabel || (isPrompt ? 'Aceptar' : 'Confirmar')}
          </button>
        </footer>
      </form>
    </div>
  );
}
