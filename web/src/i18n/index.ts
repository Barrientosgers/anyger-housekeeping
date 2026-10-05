import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es.json';

const STORAGE_KEY = 'anyger.lang';
export type Lang = 'es' | 'en';

// Each phone remembers its own language. Storage can be blocked, so every access is guarded.
function savedLanguage(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

/** True once someone on this device has picked a language with the toggle. */
export function hasSavedLanguage(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function setLanguage(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* the choice still applies until the page is closed */
  }
  return i18n.changeLanguage(lang);
}

// Spanish is the default.
void i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en } },
  lng: savedLanguage(),
  fallbackLng: 'es',
  interpolation: { escapeValue: false }, // React escapes output
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
