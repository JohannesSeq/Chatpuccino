import { useEffect, useRef, useState } from 'react';

const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

/**
 * Detecta archivos arrastrados sobre la ventana y llama a onFiles al soltarlos.
 * Devuelve `dragging` para mostrar un aviso. Con enabled=false no intercepta nada.
 */
export function useFileDrop(onFiles, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const callback = useRef(onFiles);
  callback.current = onFiles;

  useEffect(() => {
    if (!enabled) return undefined;
    let depth = 0;
    const enter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) callback.current(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      setDragging(false);
    };
  }, [enabled]);

  return dragging;
}
