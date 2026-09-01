// Small shared helpers used by several site/*.js modules.
(function (global) {
  'use strict';
  var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  function toArabicDigits(n) {
    return String(n).split('').map(function (ch) {
      return (ch >= '0' && ch <= '9') ? AR_DIGITS[+ch] : ch;
    }).join('');
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function pad3(n) { return String(n).padStart(3, '0'); }

  // Shared digit-localization used by every on-screen count (app.js's page
  // chip/counters/drawer rows, and now share.js's WhatsApp text too -- wave-2
  // fix a4/G5: the achievement text used to hardcode Arabic-Indic digits
  // regardless of the current UI language). Reads Tasme3I18n.currentLang()
  // lazily at call time (not at load time -- this file loads before i18n.js
  // in index.html's script order), so it always reflects whatever language
  // is active the moment it's called.
  function digits(n) {
    var lang = global.Tasme3I18n && global.Tasme3I18n.currentLang && global.Tasme3I18n.currentLang();
    return lang === 'ar' ? toArabicDigits(n) : String(n);
  }

  global.Tasme3Utils = { toArabicDigits: toArabicDigits, clamp: clamp, pad3: pad3, digits: digits };
})(window);
