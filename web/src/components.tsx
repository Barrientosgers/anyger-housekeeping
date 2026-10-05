import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type TranslationOutcome, api } from './api';
import { setLanguage } from './i18n';

/** One-tap language switch. The button names the language you would switch TO, in that language. */
export function LanguageToggle() {
  const { i18n } = useTranslation();
  const spanish = i18n.language !== 'en';
  return (
    <button
      className="btn quiet"
      lang={spanish ? 'en' : 'es'}
      onClick={() => void setLanguage(spanish ? 'en' : 'es')}
    >
      {spanish ? 'English' : 'Español'}
    </button>
  );
}

/**
 * A client's note with its machine translation beneath it. The original is ALWAYS shown, first and
 * unchanged; the translation is an optional extra that appears only when the note is in the other
 * language and translation works. If it is off or down, nothing breaks and nothing alarming shows
 * (apart from a small "try again" when a translation was expected but failed).
 */
export function TranslatedNote({
  entity,
  id,
  notes,
}: {
  entity: 'request' | 'appointment';
  id: string;
  notes: string;
}) {
  const { t, i18n } = useTranslation();
  const target = i18n.language === 'en' ? 'en' : 'es';
  const [outcome, setOutcome] = useState<TranslationOutcome | null>(null);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setOutcome(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let live = true;
    // Do not flash "Translating…" for notes that turn out not to need it.
    const timer = setTimeout(() => live && setSlow(true), 700);
    api
      .translateNote(entity, id, target)
      .then((r) => live && setOutcome(r))
      .catch(() => live && setOutcome({ status: 'unavailable', reason: 'network' }));
    return () => {
      live = false;
      clearTimeout(timer);
      setSlow(false);
    };
  }, [entity, id, target, attempt]);

  const translated = outcome?.status === 'translated' ? outcome : null;

  return (
    <div>
      {translated && <span className="label small-print">{t('translation.original')}</span>}
      <p className="notes">{notes}</p>
      {translated && (
        <div className="translation">
          <span className="label">{t('translation.label')}</span>
          <p className="notes">{translated.translation}</p>
        </div>
      )}
      {!outcome && slow && <p className="small-print">{t('translation.loading')}</p>}
      {outcome?.status === 'unavailable' && (
        <p className="small-print" role="status">
          {outcome.reason === 'limit' ? t('translation.limit') : t('translation.unavailable')}{' '}
          {outcome.reason !== 'limit' && (
            <button className="link-btn" onClick={retry}>
              {t('translation.retry')}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
