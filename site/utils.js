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

  global.Tasme3Utils = { toArabicDigits: toArabicDigits, clamp: clamp, pad3: pad3 };
})(window);
