import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { defaultNS, resources } from './resources';

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources,
  defaultNS,
  ns: Object.keys(resources.en),
  initAsync: false,
  returnNull: false,
  interpolation: {
    // React already escapes output; i18next must not double-escape.
    escapeValue: false,
  },
});

export default i18n;
