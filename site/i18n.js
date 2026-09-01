// Runtime i18n: loads one of the 25 catalogs from site/i18n/*.json (a build
// -time copy of app/i18n/*.json — see site/build-assets.mjs; app/i18n stays
// the source of truth), applies translations to [data-i18n] elements, and
// flips document direction per language. Browser-language autodetect with a
// localStorage override (persisted through Tasme3Storage settings.lang).
(function (global) {
  'use strict';

  var LANGS = {
    ar: { dir: 'rtl', label: 'العربية' },
    en: { dir: 'ltr', label: 'English' },
    ur: { dir: 'rtl', label: 'اردو' },
    fa: { dir: 'rtl', label: 'فارسی' },
    ps: { dir: 'rtl', label: 'پښتو' },
    tr: { dir: 'ltr', label: 'Türkçe' },
    fr: { dir: 'ltr', label: 'Français' },
    es: { dir: 'ltr', label: 'Español' },
    id: { dir: 'ltr', label: 'Bahasa Indonesia' },
    ms: { dir: 'ltr', label: 'Bahasa Melayu' },
    ru: { dir: 'ltr', label: 'Русский' },
    bn: { dir: 'ltr', label: 'বাংলা' },
    sw: { dir: 'ltr', label: 'Kiswahili' },
    ha: { dir: 'ltr', label: 'Hausa' },
    so: { dir: 'ltr', label: 'Soomaali' },
    uz: { dir: 'ltr', label: 'Oʻzbekcha' },
    az: { dir: 'ltr', label: 'Azərbaycanca' },
    bs: { dir: 'ltr', label: 'Bosanski' },
    sq: { dir: 'ltr', label: 'Shqip' },
    de: { dir: 'ltr', label: 'Deutsch' },
    nl: { dir: 'ltr', label: 'Nederlands' },
    pt: { dir: 'ltr', label: 'Português' },
    ta: { dir: 'ltr', label: 'தமிழ்' },
    ml: { dir: 'ltr', label: 'മലയാളം' },
    zh: { dir: 'ltr', label: '中文' }
  };
  var DEFAULT_LANG = 'ar';
  var cache = {};
  var current = { lang: null, dict: {} };

  function detectBrowserLang() {
    var langs = (global.navigator && (global.navigator.languages || [global.navigator.language])) || [];
    for (var i = 0; i < langs.length; i++) {
      var base = String(langs[i] || '').slice(0, 2).toLowerCase();
      if (LANGS[base]) return base;
    }
    return DEFAULT_LANG;
  }

  function fetchCatalog(lang) {
    if (cache[lang]) return cache[lang];
    cache[lang] = fetch('i18n/' + lang + '.json')
      .then(function (r) { if (!r.ok) throw new Error('i18n fetch failed: ' + lang); return r.json(); })
      .catch(function () { return {}; });
    return cache[lang];
  }

  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m;
    });
  }

  function t(key, params) {
    var dict = current.dict;
    var val = (dict && Object.prototype.hasOwnProperty.call(dict, key)) ? dict[key] : key;
    return interpolate(val, params);
  }

  function applyTranslations(root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    }
    var ph = root.querySelectorAll('[data-i18n-placeholder]');
    for (i = 0; i < ph.length; i++) {
      ph[i].placeholder = t(ph[i].getAttribute('data-i18n-placeholder'));
    }
    var al = root.querySelectorAll('[data-i18n-aria-label]');
    for (i = 0; i < al.length; i++) {
      al[i].setAttribute('aria-label', t(al[i].getAttribute('data-i18n-aria-label')));
    }
    var tl = root.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < tl.length; i++) {
      tl[i].title = t(tl[i].getAttribute('data-i18n-title'));
    }
  }

  function setLanguage(lang) {
    if (!LANGS[lang]) lang = DEFAULT_LANG;
    return fetchCatalog(lang).then(function (dict) {
      current.lang = lang;
      current.dict = dict;
      document.documentElement.lang = lang;
      document.documentElement.dir = LANGS[lang].dir;
      applyTranslations(document);
      try {
        var state = global.Tasme3Storage.load();
        state.settings.lang = lang;
        global.Tasme3Storage.save(state);
      } catch (_) {}
      document.dispatchEvent(new CustomEvent('tasme3:lang-changed', { detail: { lang: lang } }));
      return lang;
    });
  }

  function initialLanguage() {
    var stored = null;
    try { stored = global.Tasme3Storage.load().settings.lang; } catch (_) {}
    return (stored && LANGS[stored]) ? stored : detectBrowserLang();
  }

  global.Tasme3I18n = {
    LANGS: LANGS,
    t: t,
    applyTranslations: applyTranslations,
    setLanguage: setLanguage,
    initialLanguage: initialLanguage,
    currentLang: function () { return current.lang; }
  };
})(window);
