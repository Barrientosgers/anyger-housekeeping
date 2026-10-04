import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es.json';

// Spanish is the default. The one-tap English toggle arrives in Phase 2.
void i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en } },
  lng: 'es',
  fallbackLng: 'es',
  interpolation: { escapeValue: false }, // React escapes output
});

export default i18n;
