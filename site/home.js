// Home screen: where every visit starts and every action lives (founder decision):
// the recitation engine download, continue memorizing, today's review, the personal
// dashboard and the groups. A group view shows every member's progress together.
(function (global) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var A, OD = global.Tasme3OnDevice, Acc = global.Tasme3Account;
  var openGroupId = null;

  function show(id) { ['home', 'groupView'].forEach(function (x) { $(x).hidden = x !== id; }); }
  function hideAll() { $('home').hidden = true; $('groupView').hidden = true; }

  // ---- the home screen ----
  function render() {
    var t = A.t, d = A.digits, st = A.state();
    $('homeHello').textContent = st.settings.name ? t('home.helloName', { name: st.settings.name }) : t('home.hello');
    renderEngine();
    var last = st.settings.lastPage, s = last ? A.surahForPage(last) : null;
    $('hContinue').textContent = last ? t('home.continue', { where: (s ? 'سورة ' + s.name + ' · ' : '') + t('recite.page', { count: d(last) }) }) : t('home.start');
    var due = A.dueReviews();
    $('hReview').textContent = due.length ? t('home.review', { n: d(due.length) }) : t('home.noReview');
    $('hReview').disabled = !due.length;
    var pages = 0; Object.keys(st.progressByPage).forEach(function (k) { if (st.progressByPage[k].completedAt) pages++; });
    $('hPages').textContent = d(pages); $('hWords').textContent = d(A.totalWords());
    $('hStreak').textContent = d(st.streak.count || 0);
    $('hToday').textContent = d(st.today && st.today.wordsRevealed || 0);
    var pct = Math.round(1000 * pages / 604) / 10;
    $('hProg').style.width = Math.min(100, pct) + '%';
    $('hProgText').textContent = t('home.ofQuran', { p: d(pct), n: d(pages) });
    renderGroups();
  }

  function renderEngine() {
    var t = A.t, card = $('hEngine');
    if (!A.onDevice) { card.hidden = true; return; }
    card.hidden = false;
    var why = OD.supported();
    if (why) { $('hEngineText').textContent = t('ondevice.sorry'); $('hEngineBtn').hidden = true; return; }
    if (A.engineReady()) { $('hEngineText').textContent = t('home.engineReady'); $('hEngineBtn').hidden = true; $('hBar').hidden = true; $('hEngineStatus').textContent = ''; return; }
    OD.isDownloaded().then(function (have) {
      if (have) { $('hEngineText').textContent = t('ondevice.preparing'); $('hEngineBtn').hidden = true; }
    });
  }

  function startEngine() {
    var t = A.t, btn = $('hEngineBtn'), bar = $('hBar'), fill = $('hFill'), status = $('hEngineStatus');
    btn.disabled = true; bar.hidden = false; status.textContent = t('ondevice.preparing');
    OD.load(function (got, all) {
      var pct = all ? Math.floor(100 * got / all) : 0;
      fill.style.width = pct + '%'; status.textContent = t('ondevice.downloading', { pct: A.digits(pct), mb: A.digits(Math.round(got / 1e6)) });
    }).then(function () {
      A.setEngineReady(); renderEngine(); global.Tasme3Feedback.toast(t('fb.engineReady'), 'ok');
    }).catch(function (e) {
      var why = String(e && (e.message || e) || 'unknown');
      status.innerHTML = ''; status.appendChild(document.createTextNode(t('ondevice.error')));
      var small = document.createElement('small'); small.style.cssText = 'display:block;opacity:.7;font-size:.75rem;direction:ltr';
      small.textContent = why; status.appendChild(small);
      try { navigator.sendBeacon ? navigator.sendBeacon('/api/clientlog', 'engine: ' + why) : fetch('/api/clientlog', { method: 'POST', body: 'engine: ' + why }); } catch (_) {}
      btn.disabled = false; btn.textContent = t('ondevice.retry'); btn.hidden = false;
    });
  }

  // ---- groups ----
  function ensureAccount() { // groups need a (frictionless, code-only) account; make one on first use
    var st = A.state();
    if (st.profile.code) return Promise.resolve(st.profile.code);
    return Acc.createAccount(st.settings.name || null).then(function (res) {
      st.profile.code = res.code_raw; A.save(); A.sync(); return res.code_raw;
    });
  }

  function renderGroups() {
    var t = A.t, box = $('hGroups'), st = A.state();
    if (!Acc.isEnabled()) { box.textContent = t('account.comingSoon'); $('hCreate').hidden = $('hJoin').hidden = true; return; }
    if (!st.profile.code) { box.innerHTML = '<p class="hsmall">' + t('groups.none') + '</p>'; return; }
    Acc.Groups.list(st.profile.code).then(function (r) {
      if (!r.groups.length) { box.innerHTML = '<p class="hsmall">' + t('groups.none') + '</p>'; return; }
      box.innerHTML = '';
      r.groups.forEach(function (g) {
        var b = document.createElement('button'); b.className = 'gitem';
        b.innerHTML = '<span><b></b><br><small></small></span><span aria-hidden="true">‹</span>';
        b.querySelector('b').textContent = g.name;
        b.querySelector('small').textContent = t('groups.members', { count: A.digits(g.members) });
        b.onclick = function () { openGroup(g.id); };
        box.appendChild(b);
      });
    }).catch(function () { box.innerHTML = '<p class="hsmall">' + t('groups.error') + '</p>'; });
  }

  function ask(label, value) { var v = global.prompt(label, value || ''); return v && v.trim() ? v.trim() : null; }

  function createGroup() {
    var t = A.t, name = ask(t('groups.askName')); if (!name) return;
    var nick = ask(t('groups.askNick'), A.state().settings.name); if (!nick) return;
    ensureAccount().then(function (code) { return Acc.Groups.create(code, name, nick); })
      .then(function (g) { global.Tasme3Feedback.toast(t('fb.groupCreated'), 'ok'); openGroup(g.id); }).catch(function () { global.Tasme3Feedback.toast(t('groups.error'), 'err'); });
  }

  function joinGroup(invite) {
    var t = A.t;
    invite = invite || ask(t('groups.askInvite')); if (!invite) return;
    var nick = ask(invite && arguments.length ? t('groups.joinPrompt') : t('groups.askNick'), A.state().settings.name); if (!nick) return;
    ensureAccount().then(function (code) { return Acc.Groups.join(code, invite, nick); })
      .then(function (g) { global.Tasme3Feedback.toast(t('fb.joined'), 'ok'); openGroup(g.id); })
      .catch(function (e) { global.Tasme3Feedback.toast(e && e.status === 404 ? t('groups.badInvite') : t('groups.error'), 'err'); });
  }

  function openGroup(id) {
    var t = A.t, d = A.digits, code = A.state().profile.code; if (!code) return;
    openGroupId = id; show('groupView');
    $('gMembers').innerHTML = ''; $('gTogether').textContent = t('fb.loadingGroup');
    A.sync();
    Acc.Groups.view(code, id).then(function (g) {
      $('gTitle').textContent = g.name; $('gInvite').textContent = g.invite;
      var tg = g.together;
      $('gTogether').textContent = t('groups.together', { r: d(tg.recited_today), n: d(tg.members), w: d(tg.words_today), p: d(tg.pages) });
      var link = location.origin + location.pathname + '?join=' + g.invite;
      $('gShare').onclick = function () {
        var text = t('groups.shareText', { name: g.name, link: link, code: g.invite });
        if (navigator.share) navigator.share({ text: text }).catch(function () {});
        else global.open(Acc.whatsAppUrl(text), '_blank');
      };
      $('gLeave').onclick = function () {
        if (!global.confirm(t('groups.confirmLeave'))) return;
        Acc.Groups.leave(code, id).then(function () { global.Tasme3Feedback.toast(t('fb.left')); show('home'); render(); });
      };
      g.members.forEach(function (m) {
        var li = document.createElement('li'); if (m.me) li.className = 'me';
        li.innerHTML = '<span class="dot' + (m.recited_today ? ' on' : '') + '"></span><span><span class="nm"></span><br><span class="sub"></span></span><span class="num"></span>';
        li.querySelector('.nm').textContent = m.nickname;
        li.querySelector('.sub').textContent = (m.recited_today ? t('groups.recitedToday') : t('groups.notYetToday')) + ' · ' + t('groups.memberSub', { pages: d(m.pages), streak: d(m.streak) });
        li.querySelector('.num').innerHTML = d(m.words_today) + '<small>' + t('groups.todayWords') + '</small>';
        $('gMembers').appendChild(li);
      });
    }).catch(function () { $('gTogether').textContent = t('groups.error'); });
  }

  // ---- wiring ----
  function openHome() { show('home'); render(); }
  global.Tasme3Home = { open: function () { openHome(); } };

  document.addEventListener('tasme3:ready', function () {
    A = global.Tasme3App;
    $('hEngineBtn').onclick = startEngine;
    $('hContinue').onclick = function () {
      if (A.onDevice && !A.engineReady()) { $('hEngine').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('hEngineBtn').hidden || startEngine(); return; }
      hideAll();
    };
    $('hReview').onclick = function () { var due = A.dueReviews(); if (!due.length) return; hideAll(); A.startReview(due[0].page); };
    $('hCreate').onclick = createGroup;
    $('hJoin').onclick = function () { joinGroup(); };
    $('gBack').onclick = function () { show('home'); render(); };
    $('homeBtn').onclick = openHome;
    document.addEventListener('tasme3:engine-ready', function () { if (!$('home').hidden) renderEngine(); });
    var invite = new URLSearchParams(location.search).get('join');
    openHome();
    if (invite) {
      history.replaceState(null, '', location.pathname);
      setTimeout(function () { joinGroup(invite.toUpperCase()); }, 300);
    }
  });
})(window);
