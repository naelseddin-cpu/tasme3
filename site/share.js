// WhatsApp sharing (spec: docs/BUILD-PLAN.md "Feature — WhatsApp sharing").
// Always user-initiated via a visible share button — never automatic.
// Primary mechanism: https://wa.me/?text=<urlencoded message>, no API/keys.
// Where navigator.canShare({files}) is available, offers a client-rendered
// achievement-card image (gold/green, app name only, stats — never any
// Quranic text) shared as a picture; text link is the universal fallback.
(function (global) {
  'use strict';

  var APP_LINK = 'https://naelseddin-cpu.github.io/tasme3/';

  function buildWhatsAppUrl(text) {
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }

  // Wave-2 fix (a4/G5): these used to hardcode Arabic-Indic digits via
  // toArabicDigits() regardless of the current UI language -- a zh/en/fr
  // user sharing their progress got Arabic-Indic numerals inside otherwise
  // fully-translated share text. Tasme3Utils.digits() is app.js's own
  // digits() logic (Arabic-Indic for ar, Latin otherwise), exported for
  // reuse here so both places can never drift apart.
  function pageCompleteText(pageNum) {
    var t = global.Tasme3I18n.t;
    var d = global.Tasme3Utils.digits;
    return t('share.pageDone', { page: d(pageNum), link: APP_LINK });
  }

  function streakMilestoneText(days) {
    var t = global.Tasme3I18n.t;
    var d = global.Tasme3Utils.digits;
    return t('share.streakMilestone', { days: d(days), link: APP_LINK });
  }

  // Opens WhatsApp with the prefilled message. A real navigation (window.open)
  // so it works identically to any other wa.me integration; tests intercept
  // this at the browser level rather than this function faking it.
  function openWhatsApp(text) {
    var url = buildWhatsAppUrl(text);
    global.open(url, '_blank', 'noopener');
    return url;
  }

  // Renders a small achievement card: gold/green theme, app name, one stat
  // line. Deliberately contains NO Quranic text (founder constraint) — only
  // the app brand and the achievement's numbers.
  function renderAchievementCard(statLine) {
    var W = 1080, H = 1080;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    var grad = ctx.createRadialGradient(W * 0.5, H * 0.15, 40, W * 0.5, H * 0.5, W * 0.75);
    grad.addColorStop(0, '#14452a');
    grad.addColorStop(0.6, '#0c2e1b');
    grad.addColorStop(1, '#081f12');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // gold frame
    ctx.strokeStyle = '#d4b96a';
    ctx.lineWidth = 10;
    ctx.strokeRect(30, 30, W - 60, H - 60);
    ctx.strokeStyle = 'rgba(212,185,106,.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(48, 48, W - 96, H - 96);

    ctx.textAlign = 'center';
    ctx.direction = 'rtl';

    ctx.fillStyle = '#f6f1e4';
    ctx.font = '700 88px "UthmanicHafs", serif';
    ctx.fillText('تَسْمِيع', W / 2, H * 0.38);

    ctx.fillStyle = '#d4b96a';
    ctx.font = '700 56px system-ui, sans-serif';
    wrapCenteredText(ctx, statLine, W / 2, H * 0.56, W - 180, 68);

    ctx.fillStyle = 'rgba(246,241,228,.7)';
    ctx.font = '400 30px system-ui, sans-serif';
    ctx.fillText(APP_LINK.replace('https://', ''), W / 2, H * 0.88);

    return canvas;
  }

  function wrapCenteredText(ctx, text, cx, cy, maxWidth, lineHeight) {
    var words = text.split(' ');
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    var startY = cy - ((lines.length - 1) * lineHeight) / 2;
    for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, startY + i * lineHeight);
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
    });
  }

  // Tries Web Share API with an image file first; falls back to the plain
  // wa.me text link on any failure or lack of support (old phones always get
  // the text path, per spec).
  function shareAchievement(text, statLine) {
    if (global.navigator && global.navigator.canShare && global.navigator.share) {
      var canvas = renderAchievementCard(statLine);
      return canvasToBlob(canvas).then(function (blob) {
        if (!blob) return openWhatsApp(text);
        var file = new File([blob], 'tasme3-achievement.png', { type: 'image/png' });
        if (global.navigator.canShare({ files: [file] })) {
          return global.navigator.share({ files: [file], text: text }).catch(function () {
            return openWhatsApp(text);
          });
        }
        return openWhatsApp(text);
      }).catch(function () { return openWhatsApp(text); });
    }
    return Promise.resolve(openWhatsApp(text));
  }

  global.Tasme3Share = {
    APP_LINK: APP_LINK,
    buildWhatsAppUrl: buildWhatsAppUrl,
    pageCompleteText: pageCompleteText,
    streakMilestoneText: streakMilestoneText,
    openWhatsApp: openWhatsApp,
    renderAchievementCard: renderAchievementCard,
    shareAchievement: shareAchievement
  };
})(window);
