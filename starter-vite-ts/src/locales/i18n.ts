import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enBundle from './en.json';
import faBundle from './fa.json';

const savedLang = localStorage.getItem('gnext_locale') || 'fa';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: enBundle },
    fa: { translation: faBundle },
  },
  lng: savedLang,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export const updateDocumentDirection = (lang: string) => {
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.documentElement.dir = dir;
  document.documentElement.lang = lang;
  localStorage.setItem('gnext_locale', lang);
};

// Initialize direction immediately
updateDocumentDirection(savedLang);

export default i18n;
