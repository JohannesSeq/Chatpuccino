import React from 'react';
import { AiButton } from '../../../components/AiAssist.jsx';
import { Field } from '../../../components/ui.jsx';
import { useData } from '../../../data.jsx';
import { useT } from '../../../i18n.jsx';
import { joinPrompts } from '../../../../../shared/studio.js';
import DescribeImage from './DescribeImage.jsx';
import { countTags } from './helpers.js';

export default function CharacterPromptCard({ character, cs, style, items }) {
  const { t } = useT();
  const { toast } = useData();
  const { status, prompt, setPrompt, negative, setNegative, card, dirty, saving } = cs;

  if (status.state === 'loading') return <section className="card"><p className="muted" role="status">{t('common.loading')}</p></section>;
  if (status.state === 'error') {
    return (
      <section className="card stack">
        <p className="err">{status.error}</p>
        <div className="btn-row">
          <button className="btn" onClick={cs.retry}>
            {t('common.retry')}
          </button>
        </div>
      </section>
    );
  }

  const context = {
    name: character.name,
    description: card?.description || '',
    personality: card?.personality || '',
    tags: card?.tags || [],
    image_reading: card?.extensions?.image_reading || '',
    style,
  };
  const label = t('studio.characters.prompt.label');

  async function save() {
    try {
      await cs.save();
      toast(t('studio.characters.prompt.saved'));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const useDescribed = (text, mode) => setPrompt(mode === 'append' ? joinPrompts(prompt, text) : text.trim());

  return (
    <section className="card stack">
      <h3>{t('studio.characters.prompt.title')}</h3>
      <Field
        label={label}
        hint={t('studio.characters.prompt.hint')}
        action={<AiButton field="sd_character" label={label} value={prompt} onApply={setPrompt} context={context} />}
      >
        <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('studio.characters.prompt.placeholder')} />
      </Field>
      <p className="field-hint sg-count">{t('studio.characters.prompt.count', { count: countTags(prompt) })}</p>
      <details className="sg-negative" open={Boolean(negative.trim())}>
        <summary>{t('studio.characters.prompt.negative')}</summary>
        <label className="field">
          <span className="field-hint">{t('studio.characters.prompt.negative_hint')}</span>
          <textarea rows={3} value={negative} onChange={(e) => setNegative(e.target.value)} aria-label={t('studio.characters.prompt.negative')} placeholder={t('studio.characters.prompt.negative_placeholder')} />
        </label>
      </details>
      <DescribeImage character={character} items={items} onUse={useDescribed} />
      <div className="btn-row">
        <button className="btn primary" onClick={save} disabled={!dirty || saving}>
          {saving ? t('common.loading') : t('studio.characters.prompt.save')}
        </button>
        {dirty && (
          <>
            <button className="btn" onClick={cs.revert} disabled={saving}>
              {t('studio.characters.prompt.revert')}
            </button>
            <span className="sg-unsaved" role="status">
              {t('studio.characters.prompt.unsaved')}
            </span>
          </>
        )}
      </div>
    </section>
  );
}
