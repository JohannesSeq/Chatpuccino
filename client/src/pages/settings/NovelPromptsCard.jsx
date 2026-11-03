import React from 'react';
import { Field } from '../../components/ui.jsx';
import { useT } from '../../i18n.jsx';

const MAX = 20000; // mismo tope que server/presets.js (NOVEL_PROMPT_MAX)
const tokens = (s) => Math.ceil((s || '').length / 3.5);

// Modo Novela: prompts propios (se guardan en el preset activo, junto a los del chat, que la novela no usa).
export default function NovelPromptsCard({ draft, setParam }) {
  const { t } = useT();
  const fields = [
    ['novel_prompt', 'main'],
    ['novel_post_prompt', 'post'],
  ];
  return (
    <section className="card">
      <h3>{t('presets.novel.title')}</h3>
      <p className="muted">{t('presets.novel.intro')}</p>
      {fields.map(([key, id]) => (
        <Field key={key} label={t(`presets.novel.${id}.label`)} hint={t(`presets.novel.${id}.hint`)}>
          <textarea rows={5} maxLength={MAX} value={draft[key] || ''} placeholder={t(`presets.novel.${id}.placeholder`)} onChange={(e) => setParam(key, e.target.value)} />
          <small className="muted">{t('presets.prompts.tokens', { tokens: tokens(draft[key]) })}</small>
        </Field>
      ))}
    </section>
  );
}
