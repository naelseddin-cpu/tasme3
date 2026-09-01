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
  // Wave-2 fix (a4): a browser locale with NO catalog at all (e.g. ja) used
  // to fall back to DEFAULT_LANG (Arabic) -- surprising for a reader who
  // never chose Arabic and can't read it. Every genuinely SUPPORTED locale
  // (Arabic included) keeps going through the loop below exactly as before;
  // only the "nothing in LANGS matched" branch changes, to English instead.
  var UNSUPPORTED_LOCALE_LANG = 'en';
  var cache = {};
  var current = { lang: null, dict: {} };
  // Best-effort English catalog, kept around purely for the per-key and
  // whole-catalog fallback chain in fetchCatalog()/t() below -- populated by
  // setLanguage() regardless of which language is actually active.
  var enDict = null;

  function detectBrowserLang() {
    var langs = (global.navigator && (global.navigator.languages || [global.navigator.language])) || [];
    for (var i = 0; i < langs.length; i++) {
      var base = String(langs[i] || '').slice(0, 2).toLowerCase();
      if (LANGS[base]) return base;
    }
    return UNSUPPORTED_LOCALE_LANG;
  }

  // Wave-2 fix (a3 F2): a failed catalog fetch (flaky connection, cold
  // cache, a blocked request) used to resolve to an empty {} dict, so t()
  // had nothing to fall back to but the raw key string -- a French user
  // whose i18n/fr.json request failed could end up staring at literal
  // "nav.settings"/"listen.button" text throughout the UI. The fallback
  // chain is now: the requested language -> the English catalog (fetched
  // fresh if needed) -> only then raw keys (in t(), once neither catalog has
  // the key at all). Recursing into fetchCatalog('en') here also means
  // `cache['en']` ends up populated exactly once even if both this call and
  // setLanguage()'s own English pre-fetch (below) ask for it concurrently.
  function fetchCatalog(lang) {
    if (cache[lang]) return cache[lang];
    cache[lang] = fetch('i18n/' + lang + '.json')
      .then(function (r) { if (!r.ok) throw new Error('i18n fetch failed: ' + lang); return r.json(); })
      .catch(function () {
        if (lang === 'en') return {}; // English itself unreachable -- nothing left to fall back to here
        return fetchCatalog('en');
      });
    return cache[lang];
  }

  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m;
    });
  }

  // Per-key fallback chain (wave-2 fix a3 F2, finer-grained than the
  // whole-catalog fallback in fetchCatalog() above): the CURRENT language's
  // catalog might have loaded fine but simply not have this particular key
  // yet (e.g. a key added after that catalog's last translation pass) --
  // fall back to the English dict for that one key before ever surfacing the
  // raw key string.
  function t(key, params) {
    var dict = current.dict;
    var val;
    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) val = dict[key];
    else if (enDict && Object.prototype.hasOwnProperty.call(enDict, key)) val = enDict[key];
    else val = key;
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
    // Keep the English fallback catalog warm regardless of the active
    // language -- best-effort and never blocks setLanguage()'s own promise
    // on anything beyond the requested language's own catalog.
    fetchCatalog('en').then(function (d) { enDict = d; }).catch(function () {});
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
