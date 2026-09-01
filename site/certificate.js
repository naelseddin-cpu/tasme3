// Surah-completion certificates — founder feature: when every page a surah
// spans has been fully revealed, offer a simple, dignified "certificate of
// completion" the user can view again later, share, or download.
//
// Completion detection (v1, deliberately simple per spec): a surah's page
// range is [firstPage .. nextSurah.firstPage] inclusive -- i.e. every page
// strictly within the surah PLUS the boundary page it shares with the next
// surah (whose own text also starts there). The surah counts complete only
// once every page in that range has state.progressByPage[p].completedAt set
// (site/storage.js's markPageCompleted()). This slightly over-counts on
// boundary pages (a few of the "next" surah's words must also have been
// revealed before the shared page shows complete) but is the documented
// "simpler acceptable v1". No new persisted state is needed: completion is
// always re-derived from progressByPage + site/surah-index.json, which
// already exist and already sync.
//
// Certificate rendering: a reused <canvas>, drawn fresh each time it's
// opened (no server round-trip, no stored image), portrait ~1080x1528
// (phone-first -- most users are on mobile and share straight to
// WhatsApp). Background templates are optional artwork the founder
// supplies later -- see loadTemplates() below; everything renders
// correctly with zero templates present (a clean drawn fallback design)
// so this ships now and picks up real artwork later with no code changes.
// Content is multilingual: every certificate opens with the Arabic
// basmala (never translated, always Uthmani script -- see getBasmala()),
// then the rest of the text follows the viewer's current app language
// (caller passes in already-localized/interpolated strings; the surah
// name itself always stays Arabic, per the app's existing convention of
// keeping Quranic names/terms untranslated).
(function (global) {
  'use strict';

  // ---------------------------------------------------- surah completion
  function surahPageRange(surahIndexData, surahNumber) {
    var surahs = (surahIndexData && surahIndexData.surahs) || [];
    var idx = -1;
    for (var i = 0; i < surahs.length; i++) {
      if (surahs[i].number === surahNumber) { idx = i; break; }
    }
    if (idx === -1) return [];
    var first = surahs[idx].firstPage;
    var next = surahs[idx + 1];
    var last = next ? next.firstPage : (surahIndexData.pageCount || first);
    var pages = [];
    for (var p = first; p <= last; p++) pages.push(p);
    return pages;
  }

  // ------------------------------------- context-word completion integrity
  // site/app.js's drawer "select a surah" fix can land a reader mid-page,
  // at the CHOSEN surah's first word, with every word before it (the tail
  // of a PRECEDING surah still printed on that same page) unveiled as
  // CONTEXT rather than genuinely recited (site/storage.js's
  // progressByPage[page].contextRevealed). A page's `completedAt` only
  // ever means "the pointer reached the end of the page" -- reciting the
  // chosen surah through to the end of a shared page still sets it, even
  // though the preceding surah's own words never entered `revealed`. So
  // `completedAt` alone is no longer sufficient proof a given SURAH is
  // complete: for any page that ever had a context jump on it
  // (contextRevealed non-empty), completion is re-checked at the WORD
  // level -- every one of that surah's own word indices on that page (read
  // from the same page-NNN.json tokens app.js loads, via token key `k`)
  // must actually be in `revealed`. Pages that never had a context jump
  // skip this fetch entirely and keep the original, cheap completedAt-only
  // check. On any failure to load a page's tokens this fails CLOSED
  // (treated as incomplete) -- a missed celebration costs nothing, a false
  // certificate would not be acceptable.
  var _pageSurahByWordCache = {};
  function loadPageWordSurahs(pageNum) {
    if (_pageSurahByWordCache[pageNum]) return _pageSurahByWordCache[pageNum];
    var nnn = String(pageNum).padStart(3, '0');
    var p = fetch('pages/page-' + nnn + '.json').then(function (r) {
      if (!r.ok) throw new Error('page fetch failed');
      return r.json();
    }).then(function (data) {
      var out = [];
      (data.tokens || []).forEach(function (tk) {
        if (tk.e) return; // ayah-marker token, not a word
        var n = tk.k ? parseInt(String(tk.k).split(':')[0], 10) : NaN;
        out.push(Number.isFinite(n) ? n : null);
      });
      return out;
    }).catch(function () { return null; });
    _pageSurahByWordCache[pageNum] = p;
    return p;
  }

  function pageSurahWordsGenuinelyRevealed(entry, pageNum, surahNumber) {
    return loadPageWordSurahs(pageNum).then(function (bySurah) {
      if (!bySurah) return false; // couldn't verify -- fail closed
      var revealedSet = {};
      (entry.revealed || []).forEach(function (i) { revealedSet[i] = true; });
      for (var i = 0; i < bySurah.length; i++) {
        if (bySurah[i] === surahNumber && !revealedSet[i]) return false;
      }
      return true;
    });
  }

  // Returns Promise<boolean>.
  function isSurahComplete(state, surahIndexData, surahNumber) {
    var pages = surahPageRange(surahIndexData, surahNumber);
    if (!pages.length) return Promise.resolve(false);
    var checks = pages.map(function (p) {
      var entry = state.progressByPage[String(p)];
      if (!entry || !entry.completedAt) return Promise.resolve(false);
      if (!entry.contextRevealed || !entry.contextRevealed.length) return Promise.resolve(true);
      return pageSurahWordsGenuinelyRevealed(entry, p, surahNumber);
    });
    return Promise.all(checks).then(function (results) {
      return results.every(function (ok) { return ok; });
    });
  }

  // Surahs whose range includes pageNum and that are complete right now --
  // call once right after Tasme3Storage.markPageCompleted(state, pageNum)
  // to find out what to celebrate. Returns Promise<surah[]>.
  function newlyCompletedSurahs(state, surahIndexData, pageNum) {
    var surahs = (surahIndexData && surahIndexData.surahs) || [];
    var candidates = surahs.filter(function (s) {
      return surahPageRange(surahIndexData, s.number).indexOf(pageNum) !== -1;
    });
    return Promise.all(candidates.map(function (s) {
      return isSurahComplete(state, surahIndexData, s.number).then(function (done) { return done ? s : null; });
    })).then(function (results) { return results.filter(Boolean); });
  }

  // Every currently-complete surah, for the "شهاداتي" (My Certificates)
  // list -- {number, name, completedAt}, sorted by surah number. Returns
  // Promise<item[]>.
  function completedSurahList(state, surahIndexData) {
    var surahs = (surahIndexData && surahIndexData.surahs) || [];
    return Promise.all(surahs.map(function (s) {
      return isSurahComplete(state, surahIndexData, s.number).then(function (done) {
        if (!done) return null;
        var pages = surahPageRange(surahIndexData, s.number);
        var lastEntry = state.progressByPage[String(pages[pages.length - 1])];
        return { number: s.number, name: s.name, completedAt: lastEntry ? lastEntry.completedAt : null };
      });
    })).then(function (results) { return results.filter(Boolean); });
  }

  // ------------------------------------------------ background templates
  var TEMPLATE_EXTS = ['webp', 'png', 'jpg'];
  var MAX_NUMBERED_TEMPLATES = 6;

  // Checks existence via fetch() first (a plain 404 status here is silent --
  // unlike an <img src> 404, it is NOT auto-logged as a console error by the
  // browser), then decodes the bytes into an <img> from a blob: URL for
  // canvas use. This is what makes probing up to ~21 maybe-missing files on
  // every load silent/expected rather than console noise, while still
  // requiring zero manifest file to keep in sync with what's actually there.
  function tryLoadImage(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) return null;
      return r.blob();
    }).then(function (blob) {
      if (!blob || !blob.size) return null;
      return new Promise(function (resolve) {
        var objUrl = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(objUrl); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(objUrl); resolve(null); };
        img.src = objUrl;
      });
    }).catch(function () { return null; });
  }

  // First of webp/png/jpg that actually loads for a given base path, else null.
  function tryLoadAnyExt(basePath) {
    var exts = TEMPLATE_EXTS.slice();
    function next() {
      if (!exts.length) return Promise.resolve(null);
      var ext = exts.shift();
      return tryLoadImage(basePath + '.' + ext).then(function (img) { return img || next(); });
    }
    return next();
  }

  // Discovers certificate background artwork: certificate-bg-1 .. -6 (each
  // tried as .webp/.png/.jpg, first hit wins per slot), skipping any slot
  // that 404s. If NONE of the numbered slots exist, falls back to the
  // single legacy certificate-bg.* as the one template. Returns
  // Promise<HTMLImageElement[]> -- empty when no artwork exists yet, which
  // callers treat as "use the drawn fallback design". Pure probe, no
  // manifest file to keep in sync -- artwork can be dropped in later with
  // no code changes.
  function loadTemplates() {
    var slots = [];
    for (var i = 1; i <= MAX_NUMBERED_TEMPLATES; i++) slots.push(i);
    return Promise.all(slots.map(function (n) {
      return tryLoadAnyExt('assets/certificate-bg-' + n);
    })).then(function (imgs) {
      var found = imgs.filter(Boolean);
      if (found.length) return found;
      return tryLoadAnyExt('assets/certificate-bg').then(function (legacy) {
        return legacy ? [legacy] : [];
      });
    });
  }

  // Deterministic: a given surah always renders with the same template.
  function templateForSurah(surahNumber, templates) {
    if (!templates || !templates.length) return null;
    return templates[(surahNumber - 1) % templates.length];
  }

  // ------------------------------------------------------------- dates
  // Locale-formatted in the given UI language. For Arabic specifically,
  // try the Islamic (Hijri) calendar via Intl first; every language
  // (Arabic included, on fallback) gets a plain Gregorian date formatted
  // in its own language/script.
  function certificateDate(lang) {
    lang = lang || 'ar';
    if (lang === 'ar') {
      try {
        var fmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' });
        if (/islamic/.test(fmt.resolvedOptions().calendar)) return fmt.format(new Date());
      } catch (_) { /* fall through to Gregorian */ }
    }
    try {
      return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
    } catch (_) {
      try {
        return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
      } catch (_e) {
        return new Date().toISOString().slice(0, 10);
      }
    }
  }

  // ------------------------------------------------------- basmala + font
  // The basmala is NEVER translated/transliterated -- Arabic Uthmani script
  // in every certificate regardless of UI language. Its text is fetched
  // from basmala.json, which site/build-assets.mjs generates by extracting
  // ayah 1:1's word tokens directly from app/mushaf/pages/page-001.json
  // (the same verified source the mushaf page renderer uses) -- it is never
  // hand-typed here, to guarantee byte-fidelity with the real mushaf text.
  var _basmalaPromise = null;
  function getBasmala() {
    if (!_basmalaPromise) {
      _basmalaPromise = fetch('basmala.json')
        .then(function (r) { if (!r.ok) throw new Error('basmala fetch failed'); return r.json(); })
        .then(function (d) { return d.text; })
        .catch(function () {
          try { console.warn('Tasme3Certificate: could not load basmala.json -- basmala line will be skipped'); } catch (_) {}
          return null;
        });
    }
    return _basmalaPromise;
  }

  // Forces the UthmanicHafs @font-face (already shipped inline in
  // site/fonts.css, used elsewhere for the header logo and the share-card
  // canvas) to finish loading before we draw with it, so the basmala and
  // other Arabic lines never silently fall back to a generic serif.
  function ensureFontLoaded(px) {
    if (!global.document || !document.fonts || !document.fonts.load) return Promise.resolve(false);
    var spec = '700 ' + px + 'px "UthmanicHafs"';
    return document.fonts.load(spec).then(function () {
      return document.fonts.ready;
    }).then(function () {
      try { return document.fonts.check(spec); } catch (_) { return true; }
    }).catch(function () { return false; });
  }

  // -------------------------------------------------------- canvas render
  // Portrait, phone-first (90% of users are mobile; shared straight to
  // WhatsApp) -- roughly A4-like ratio, fills a phone screen well.
  var CANVAS_W = 1080, CANVAS_H = 1528;

  function drawFallbackBackground(ctx) {
    ctx.fillStyle = '#fdfaf0'; // cream ground
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    var pad = 46;
    ctx.strokeStyle = '#a8862f';
    ctx.lineWidth = 10;
    ctx.strokeRect(pad, pad, CANVAS_W - pad * 2, CANVAS_H - pad * 2);
    ctx.strokeStyle = '#0e3d24';
    ctx.lineWidth = 3;
    ctx.strokeRect(pad + 20, pad + 20, CANVAS_W - (pad + 20) * 2, CANVAS_H - (pad + 20) * 2);
    var inset = pad + 20;
    var corners = [
      [inset, inset], [CANVAS_W - inset, inset],
      [inset, CANVAS_H - inset], [CANVAS_W - inset, CANVAS_H - inset]
    ];
    ctx.strokeStyle = '#d4b96a';
    ctx.lineWidth = 4;
    corners.forEach(function (c) {
      ctx.beginPath(); ctx.arc(c[0], c[1], 34, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(c[0], c[1], 20, 0, Math.PI * 2); ctx.stroke();
    });
  }

  function drawBackgroundImage(ctx, img) {
    var scale = Math.max(CANVAS_W / img.width, CANVAS_H / img.height);
    var w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
  }

  // Same word-wrap-and-center helper pattern as share.js's achievement card.
  function wrapCenteredText(ctx, text, cx, cy, maxWidth, lineHeight) {
    var words = text.split(' ');
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    var startY = cy - ((lines.length - 1) * lineHeight) / 2;
    for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, startY + i * lineHeight);
    return lines.length;
  }

  // Single-line text (title, name) must never overflow the panel, but a
  // 2-line wrap looks wrong for those roles -- shrink the font instead.
  // Title/name length varies a lot by language ("شهادة إتمام" vs
  // "Certificate of Completion") and by what the user typed as their name,
  // so this is not optional polish, it's the fix for real overflow.
  function fitSingleLineFontPx(ctx, text, fontOf, maxWidth, startPx, minPx) {
    var px = startPx;
    while (px > minPx) {
      ctx.font = fontOf(px);
      if (ctx.measureText(text).width <= maxWidth) break;
      px -= 2;
    }
    return px;
  }

  // opts: {
  //   name: string|null,            -- as entered, never translated
  //   surahName: string,            -- always Arabic, from surah-index.json
  //   titleText: string,            -- localized cert.title
  //   congratsText: string,         -- localized cert.congrats
  //   completedSurahText: string,   -- localized cert.completedSurah, {surah}
  //                                    already interpolated with surahName
  //   dateStr: string,              -- certificateDate(lang) result
  //   dir: 'rtl'|'ltr',             -- text direction for localized lines
  //   template: HTMLImageElement|null,
  //   appLink: string
  // }
  // Returns Promise<canvas> -- async because it awaits the basmala text and
  // the UthmanicHafs font before drawing a single pixel of Arabic text.
  function renderCertificate(opts) {
    var basmalaFontPx = Math.round(CANVAS_W * 0.052);
    return Promise.all([getBasmala(), ensureFontLoaded(basmalaFontPx)]).then(function (results) {
      var basmala = results[0];
      var fontReady = results[1];
      if (!fontReady) {
        try { console.warn('Tasme3Certificate: UthmanicHafs not confirmed loaded before render'); } catch (_) {}
      }

      var canvas = document.createElement('canvas');
      canvas.width = CANVAS_W; canvas.height = CANVAS_H;
      var ctx = canvas.getContext('2d');
      var hasTemplate = !!opts.template;

      if (hasTemplate) drawBackgroundImage(ctx, opts.template);
      else drawFallbackBackground(ctx);

      // Clear/content panel: template artwork's clear center is specced as
      // roughly the central 70% width / 55% height. In practice ornamental
      // illumination frames often taper inward near the top (an arch/mihrab
      // shape), so the actually-clear width right where the basmala/title
      // sit can be narrower than a flat 70% -- box width is pulled in a bit
      // (62%) and every text line below adds its own safety margin on top
      // of that, rather than assuming the full nominal box width is usable
      // right up to its edges. The drawn fallback (a plain rectangle, no
      // taper) can safely use the fuller box.
      var box;
      if (hasTemplate) {
        var bw = CANVAS_W * 0.62, bh = CANVAS_H * 0.55;
        box = { x: (CANVAS_W - bw) / 2, y: (CANVAS_H - bh) / 2, w: bw, h: bh };
      } else {
        var mx = CANVAS_W * 0.14, my = CANVAS_H * 0.16;
        box = { x: mx, y: my, w: CANVAS_W - mx * 2, h: CANVAS_H - my * 2 };
      }

      // Dark green/gold reads well on both cream (fallback) and a
      // cream/light illuminated-artwork center panel.
      var textColor = '#123420';
      var goldColor = '#8a6d1f';
      var localDir = opts.dir === 'ltr' ? 'ltr' : 'rtl';

      ctx.textAlign = 'center';
      var cx = box.x + box.w / 2;
      var y = box.y + box.h * 0.09;

      // 1. Basmala -- always Arabic Uthmani, always centered, always RTL.
      // Shrunk to fit one line same as title/name below (see box-width
      // comment above re: tapered artwork frames).
      if (basmala) {
        ctx.direction = 'rtl';
        ctx.fillStyle = goldColor;
        var basmalaFontOf = function (px) { return '700 ' + px + 'px "UthmanicHafs", serif'; };
        var basmalaPx = fitSingleLineFontPx(ctx, basmala, basmalaFontOf, box.w * 0.82, basmalaFontPx, Math.round(box.w * 0.03));
        ctx.font = basmalaFontOf(basmalaPx);
        ctx.fillText(basmala, cx, y);
        y += box.h * 0.095;
      }

      ctx.direction = localDir;

      // 2. Title (localized) -- shrunk to fit one line regardless of
      // language ("شهادة إتمام" vs "Certificate of Completion" vs
      // "Sertifikat Penyelesaian" are very different lengths).
      ctx.fillStyle = goldColor;
      var titleFontOf = function (px) { return '700 ' + px + 'px "UthmanicHafs", serif'; };
      var titlePx = fitSingleLineFontPx(ctx, opts.titleText, titleFontOf, box.w * 0.82, Math.round(box.w * 0.095), Math.round(box.w * 0.04));
      ctx.font = titleFontOf(titlePx);
      ctx.fillText(opts.titleText, cx, y);
      y += box.h * 0.065;

      // divider
      ctx.strokeStyle = goldColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - box.w * 0.16, y);
      ctx.lineTo(cx + box.w * 0.16, y);
      ctx.stroke();
      y += box.h * 0.065;

      // 3. Congrats line (localized, may wrap).
      ctx.fillStyle = textColor;
      ctx.font = '400 ' + Math.round(box.w * 0.034) + 'px system-ui, sans-serif';
      var congratsLH = box.h * 0.042;
      var congratsLines = wrapCenteredText(ctx, opts.congratsText, cx, y, box.w * 0.86, congratsLH);
      y += congratsLH * Math.max(1, congratsLines) * 0.65 + box.h * 0.055;

      // 4. Name (as entered, optional -- skip entirely if none given).
      // Also shrunk to fit one line -- names are free text, up to 40 chars.
      if (opts.name) {
        ctx.fillStyle = textColor;
        var nameFontOf = function (px) { return '700 ' + px + 'px "UthmanicHafs", serif'; };
        var namePx = fitSingleLineFontPx(ctx, opts.name, nameFontOf, box.w * 0.82, Math.round(box.w * 0.065), Math.round(box.w * 0.03));
        ctx.font = nameFontOf(namePx);
        ctx.fillText(opts.name, cx, y);
        y += box.h * 0.09;
      }

      // 5. Completed-surah line (localized sentence, Arabic surah name
      // already interpolated into completedSurahText by the caller).
      ctx.fillStyle = textColor;
      ctx.font = '600 ' + Math.round(box.w * 0.055) + 'px "UthmanicHafs", serif';
      var surahLH = box.h * 0.062;
      var surahLines = wrapCenteredText(ctx, opts.completedSurahText, cx, y, box.w * 0.84, surahLH);
      y += surahLH * Math.max(1, surahLines) * 0.6 + box.h * 0.075;

      // 6. Date (locale-formatted for the current language).
      ctx.fillStyle = goldColor;
      ctx.font = '400 ' + Math.round(box.w * 0.036) + 'px system-ui, sans-serif';
      ctx.fillText(opts.dateStr, cx, y);
      y += box.h * 0.075;

      // 7. Small app mark + link -- always the Arabic brand mark, same
      // precedent as share.js's achievement card (app identity stays
      // Arabic on generated imagery regardless of UI language).
      ctx.direction = 'rtl';
      ctx.fillStyle = textColor;
      ctx.font = '700 ' + Math.round(box.w * 0.042) + 'px "UthmanicHafs", serif';
      ctx.fillText('تَسْمِيع', cx, y);
      y += box.h * 0.038;
      ctx.fillStyle = goldColor;
      ctx.font = '400 ' + Math.round(box.w * 0.028) + 'px system-ui, sans-serif';
      ctx.fillText((opts.appLink || '').replace('https://', ''), cx, y);

      return canvas;
    });
  }

  // ------------------------------------------------------- share/download
  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
    });
  }

  function openWaFallback(text) {
    var url = 'https://wa.me/?text=' + encodeURIComponent(text);
    global.open(url, '_blank', 'noopener');
    return url;
  }

  // Web Share API with the image file when available (same pattern as
  // share.js's shareAchievement); wa.me text link otherwise/on any failure.
  function shareCertificate(canvas, text, filename) {
    if (global.navigator && global.navigator.canShare && global.navigator.share) {
      return canvasToBlob(canvas).then(function (blob) {
        if (!blob) return openWaFallback(text);
        var file = new File([blob], filename || 'certificate.png', { type: 'image/png' });
        if (global.navigator.canShare({ files: [file] })) {
          return global.navigator.share({ files: [file], text: text }).catch(function () { return openWaFallback(text); });
        }
        return openWaFallback(text);
      }).catch(function () { return openWaFallback(text); });
    }
    return Promise.resolve(openWaFallback(text));
  }

  function downloadCanvas(canvas, filename) {
    return canvasToBlob(canvas).then(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename || 'certificate.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }

  global.Tasme3Certificate = {
    surahPageRange: surahPageRange,
    isSurahComplete: isSurahComplete,
    newlyCompletedSurahs: newlyCompletedSurahs,
    completedSurahList: completedSurahList,
    loadTemplates: loadTemplates,
    templateForSurah: templateForSurah,
    certificateDate: certificateDate,
    renderCertificate: renderCertificate,
    shareCertificate: shareCertificate,
    downloadCanvas: downloadCanvas,
    CANVAS_W: CANVAS_W,
    CANVAS_H: CANVAS_H
  };
})(window);
