import { useTranslation } from 'react-i18next';
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
