/**
 * app.js — Main application logic for Quran Memorization Trainer.
 * Browser-only, vanilla JS (ES modules), no framework.
 */

import { surahs } from "./quran-data.js";
import { normalizeArabic, matchTranscript } from "./matcher.js";

/* ==================== CONFIG ==================== */
const STORAGE_KEYS = {
  profile: "qmt_profile",
  progress: "qmt_progress",
  streak: "qmt_streak",
  review: "qmt_review",
  session: "qmt_session",
  today: "qmt_today",
};

const ASR_MODEL = "onnx-community/whisper-base";
const ASR_PIPELINE = "automatic-speech-recognition";
const ASR_LANG = "arabic";
const ASR_TASK = "transcribe";
const TARGET_SAMPLE_RATE = 16000;

/* ==================== STATE ==================== */
let state = {
  lang: "ar",
  profile: null,
  progress: {},
  streak: { count: 0, lastActiveDate: null },
  review: { date: null, items: [] },
  today: { date: null, count: 0 },
  session: null,
  asr: null,
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  translations: {},
};

/* ==================== DOM CACHE ==================== */
const els = {};

function cacheElements() {
  els.appTitle = document.getElementById("app-title");
  els.langSwitcher = document.getElementById("lang-switcher");
  els.navButtons = document.querySelectorAll(".nav-btn");
  els.views = document.querySelectorAll(".view");
  els.surahGrid = document.getElementById("surah-grid");
  els.viewLoading = document.getElementById("view-loading");
  els.modelProgress = document.getElementById("model-progress");
  els.modelStatus = document.getElementById("model-status");
  els.retryModelBtn = document.getElementById("retry-model-btn");
  els.surahName = document.getElementById("surah-name");
  els.ayahNumber = document.getElementById("ayah-number");
  els.ayahText = document.getElementById("ayah-text");
  els.prevAyah = document.getElementById("prev-ayah");
  els.nextAyah = document.getElementById("next-ayah");
  els.levelSelector = document.getElementById("level-selector");
  els.reciteBtn = document.getElementById("recite-btn");
  els.feedback = document.getElementById("feedback");
  els.profileForm = document.getElementById("profile-form");
  els.nickname = document.getElementById("nickname");
  els.dailyTarget = document.getElementById("daily-target");
  els.defaultLevel = document.getElementById("default-level");
  els.streakValue = document.getElementById("streak-value");
  els.totalAyatValue = document.getElementById("total-ayat-value");
  els.todayProgressValue = document.getElementById("today-progress-value");
  els.surahProgressList = document.getElementById("surah-progress-list");
  els.reviewContent = document.getElementById("review-content");
  els.skipReviewBtn = document.getElementById("skip-review-btn");
}

/* ==================== LOCAL STORAGE ==================== */
function loadState() {
  try {
    state.profile = JSON.parse(localStorage.getItem(STORAGE_KEYS.profile)) || getDefaultProfile();
    state.progress = JSON.parse(localStorage.getItem(STORAGE_KEYS.progress)) || {};
    state.streak = JSON.parse(localStorage.getItem(STORAGE_KEYS.streak)) || { count: 0, lastActiveDate: null };
    state.review = JSON.parse(localStorage.getItem(STORAGE_KEYS.review)) || { date: null, items: [] };
    state.today = JSON.parse(localStorage.getItem(STORAGE_KEYS.today)) || { date: null, count: 0 };

    const rawSession = localStorage.getItem(STORAGE_KEYS.session);
    if (rawSession) {
      const parsed = JSON.parse(rawSession);
      if (parsed && parsed.revealedWords) {
        parsed.revealedWords = new Set(parsed.revealedWords);
      }
      state.session = parsed;
    }
  } catch (e) {
    console.error("Failed to load state", e);
    resetState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(state.profile));
  localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(state.progress));
  localStorage.setItem(STORAGE_KEYS.streak, JSON.stringify(state.streak));
  localStorage.setItem(STORAGE_KEYS.review, JSON.stringify(state.review));
  localStorage.setItem(STORAGE_KEYS.today, JSON.stringify(state.today));
  if (state.session) {
    const toSave = { ...state.session, revealedWords: Array.from(state.session.revealedWords) };
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(toSave));
  } else {
    localStorage.removeItem(STORAGE_KEYS.session);
  }
}

function resetState() {
  state.profile = getDefaultProfile();
  state.progress = {};
  state.streak = { count: 0, lastActiveDate: null };
  state.review = { date: null, items: [] };
  state.today = { date: null, count: 0 };
  state.session = null;
}

function getDefaultProfile() {
  return {
    nickname: "",
    dailyTarget: 5,
    difficulty: 2,
    language: "ar",
  };
}

/* ==================== I18N ==================== */
async function loadTranslations(lang) {
  if (state.translations[lang]) return;
  try {
    const res = await fetch(`./i18n/${lang}.json`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.translations[lang] = await res.json();
  } catch (e) {
    console.error(`Failed to load ${lang} translations`, e);
    state.translations[lang] = {};
  }
}

function t(key) {
  const keys = key.split(".");
  let val = state.translations[state.lang];
  for (const k of keys) {
    if (val && typeof val === "object" && val[k] !== undefined) {
      val = val[k];
    } else {
      return key;
    }
  }
  return typeof val === "string" ? val : key;
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = t(key);
    if (text !== key) el.textContent = text;
  });

  document.title = t("app.title");
  const isRTL = ["ar", "ur"].includes(state.lang);
  document.documentElement.dir = isRTL ? "rtl" : "ltr";
  document.documentElement.lang = state.lang;

  document.querySelectorAll("option[data-i18n]").forEach((opt) => {
    const key = opt.getAttribute("data-i18n");
    const text = t(key);
    if (text !== key) opt.textContent = text;
  });
}

async function setLanguage(lang) {
  state.lang = lang;
  state.profile.language = lang;
  await loadTranslations(lang);
  applyTranslations();
  saveState();
  renderSurahGrid();
  renderProgress();
  if (state.session) renderAyah();
}

/* ==================== VIEWS ==================== */
function showView(viewName) {
  els.views.forEach((v) => v.classList.remove("active"));
  const view = document.getElementById(`view-${viewName}`);
  if (view) view.classList.add("active");

  els.navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === viewName);
  });

  if (viewName === "select") renderSurahGrid();
  if (viewName === "progress") renderProgress();
  if (viewName === "profile") renderProfile();
  if (viewName === "review") renderReview();
}

/* ==================== ASR (transformers.js) ==================== */
async function initASR() {
  if (state.asr) return;

  els.viewLoading.classList.add("active");
  document.getElementById("view-select")?.classList.remove("active");
  els.retryModelBtn.classList.add("hidden");
  els.modelProgress.style.width = "0%";
  els.modelStatus.textContent = "";

  try {
    const { pipeline, env } = await import(
      "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm"
    );
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    state.asr = await pipeline(ASR_PIPELINE, ASR_MODEL, {
      dtype: "fp32",
      progress_callback: (progress) => {
        if (!progress) return;
        if (progress.status === "download" && progress.total) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          els.modelProgress.style.width = pct + "%";
          els.modelStatus.textContent = progress.file
            ? `${progress.file} — ${pct}%`
            : `${pct}%`;
        } else if (progress.status === "ready") {
          els.modelProgress.style.width = "100%";
          els.modelStatus.textContent = t("msg.modelLoading");
        }
      },
    });

    els.viewLoading.classList.remove("active");
    // Do not force a view change — respect whatever view the user is on
    updateReciteButtonState();
  } catch (err) {
    console.error("ASR init failed", err);
    els.retryModelBtn.classList.remove("hidden");
    els.modelStatus.textContent = t("msg.modelLoadError");
  }
}

/* ==================== AUDIO ==================== */
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/mp4";
    state.mediaRecorder = new MediaRecorder(stream, { mimeType });
    state.audioChunks = [];

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.audioChunks.push(e.data);
    };

    state.mediaRecorder.onstop = async () => {
      const blob = new Blob(state.audioChunks, { type: mimeType });
      stream.getTracks().forEach((t) => t.stop());
      await processAudio(blob);
    };

    state.mediaRecorder.start();
    state.isRecording = true;
    updateReciteButton();
    setFeedback("msg.listening", "success");
  } catch (err) {
    console.error("Mic access denied", err);
    setFeedback("msg.micDenied", "error");
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
    state.isRecording = false;
    updateReciteButton();
    setFeedback("msg.processing", "hint");
  }
}

async function processAudio(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    audioCtx.close();

    // Resample to 16 kHz mono via OfflineAudioContext
    const targetLength = Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE);
    const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    const rendered = await offlineCtx.startRendering();
    const audioData = rendered.getChannelData(0);

    // Transcribe
    const result = await state.asr(audioData, {
      language: ASR_LANG,
      task: ASR_TASK,
    });
    const transcript = result?.text || "";

    if (!transcript.trim()) {
      setFeedback("msg.emptyTranscript", "error");
      return;
    }

    handleTranscript(transcript);
  } catch (err) {
    console.error("Audio processing failed", err);
    setFeedback("msg.tryAgain", "error");
  }
}

/* ==================== MATCHING & LOGIC ==================== */
function handleTranscript(transcript) {
  if (!state.session) return;

  const surah = surahs.find((s) => s.id === state.session.surahId);
  const ayahWords = surah.ayat[state.session.ayahIndex];
  const normalizedExpected = ayahWords.map(normalizeArabic);
  const normalizedTranscript = normalizeArabic(transcript);

  const result = matchTranscript(
    normalizedExpected,
    state.session.pointer,
    normalizedTranscript,
    state.session.level
  );

  let newMatches = 0;
  for (const idx of result.matched) {
    if (!state.session.revealedWords.has(idx)) {
      state.session.revealedWords.add(idx);
      newMatches++;
    }
  }
  state.session.pointer = result.pointer;

  saveState();
  renderAyah();

  if (newMatches > 0) {
    if (state.session.pointer >= ayahWords.length) {
      setFeedback("msg.ayahComplete", "success");
      completeAyah();
    } else {
      setFeedback("msg.excellent", "success");
    }
  } else {
    setFeedback("msg.tryAgain", "error");
  }
}

function completeAyah() {
  const surah = surahs.find((s) => s.id === state.session.surahId);
  const sid = state.session.surahId;
  const aidx = state.session.ayahIndex;

  // If this was a review session, remove from review list
  if (state.session.reviewMode) {
    state.review.items = state.review.items.filter(
      (r) => !(r.surahId === sid && r.ayahIndex === aidx)
    );
    state.session.reviewMode = false;
  }

  let sp = state.progress[sid];
  if (!sp) {
    sp = { highestWordIndex: -1, level: state.session.level, completedAyat: [], lastReviewed: null };
  }

  if (!sp.completedAyat.includes(aidx)) {
    sp.completedAyat.push(aidx);
  }

  const wordsBefore = surah.ayat
    .slice(0, aidx)
    .reduce((sum, a) => sum + a.length, 0);
  const currentWordIndex = wordsBefore + surah.ayat[aidx].length - 1;
  if (currentWordIndex > sp.highestWordIndex) {
    sp.highestWordIndex = currentWordIndex;
  }
  if (state.session.level > (sp.level || 0)) {
    sp.level = state.session.level;
  }

  state.progress[sid] = sp;
  updateTodayCount();
  updateStreak();

  const todayStr = new Date().toISOString().split("T")[0];
  const alreadyInReview = state.review.items.find(
    (r) => r.surahId === sid && r.ayahIndex === aidx
  );
  if (!alreadyInReview) {
    state.review.items.push({
      surahId: sid,
      ayahIndex: aidx,
      date: todayStr,
    });
  }

  saveState();

  if (aidx < surah.ayat.length - 1) {
    setTimeout(() => nextAyah(), 1800);
  } else {
    setFeedback("msg.surahComplete", "success");
  }
}

function updateTodayCount() {
  const todayStr = new Date().toISOString().split("T")[0];
  if (state.today.date !== todayStr) {
    state.today = { date: todayStr, count: 0 };
  }
  state.today.count++;
}

function updateStreak() {
  const todayStr = new Date().toISOString().split("T")[0];
  if (state.streak.lastActiveDate === todayStr) return;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  if (state.streak.lastActiveDate === yesterdayStr) {
    state.streak.count++;
  } else {
    state.streak.count = 1;
  }
  state.streak.lastActiveDate = todayStr;
}

/* ==================== RENDERING ==================== */
function renderSurahGrid() {
  els.surahGrid.innerHTML = "";
  surahs.forEach((surah) => {
    const sp = state.progress[surah.id];
    const total = surah.ayat.length;
    const completed = sp ? sp.completedAyat.length : 0;
    const pct = total > 0 ? (completed / total) * 100 : 0;

    const card = document.createElement("div");
    card.className = "surah-card";
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.innerHTML = `
      <h3>${surah.name}</h3>
      <div class="en-name">${surah.englishName}</div>
      <div class="progress-bar-mini">
        <div class="progress-bar-mini-fill" style="width:${pct}%"></div>
      </div>
      <div class="progress-text">${completed}/${total} ${t("msg.completion")}</div>
    `;
    card.addEventListener("click", () => startMemorization(surah.id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") startMemorization(surah.id);
    });
    els.surahGrid.appendChild(card);
  });
}

function startMemorization(surahId, ayahIndex, isReview) {
  const surah = surahs.find((s) => s.id === surahId);
  const startIdx =
    typeof ayahIndex === "number"
      ? ayahIndex
      : findNextUncompletedAyah(surahId);

  state.session = {
    surahId,
    ayahIndex: startIdx,
    revealedWords: new Set(),
    pointer: 0,
    level: state.profile.difficulty,
    reviewMode: !!isReview,
  };
  saveState();
  els.levelSelector.value = state.session.level;
  showView("memorize");
  renderAyah();
  setFeedback("msg.pressToRecite", "hint");
}

function findNextUncompletedAyah(surahId) {
  const sp = state.progress[surahId];
  const surah = surahs.find((s) => s.id === surahId);
  if (!sp) return 0;
  for (let i = 0; i < surah.ayat.length; i++) {
    if (!sp.completedAyat.includes(i)) return i;
  }
  return 0; // all done, restart from beginning
}

function renderAyah() {
  if (!state.session) return;

  const surah = surahs.find((s) => s.id === state.session.surahId);
  if (!surah || !surah.ayat[state.session.ayahIndex]) {
    // Invalid session, reset
    state.session = null;
    saveState();
    showView("select");
    return;
  }
  const ayahWords = surah.ayat[state.session.ayahIndex];

  els.surahName.textContent = surah.name;
  els.ayahNumber.textContent = `﴿${toArabicNumber(state.session.ayahIndex + 1)}﴾`;

  els.ayahText.innerHTML = "";
  ayahWords.forEach((word, idx) => {
    const span = document.createElement("span");
    span.className = "word";
    if (state.session.revealedWords.has(idx)) {
      span.classList.add("revealed");
      span.textContent = word;
      span.setAttribute("aria-label", word);
    } else {
      span.classList.add("hidden");
      span.textContent = "\u200B";
      span.setAttribute("aria-hidden", "true");
    }
    els.ayahText.appendChild(span);
  });

  const marker = document.createElement("span");
  marker.className = "ayah-marker";
  marker.setAttribute("aria-label", `${t("label.ayah")} ${state.session.ayahIndex + 1}`);
  marker.textContent = `﴿${toArabicNumber(state.session.ayahIndex + 1)}﴾`;
  els.ayahText.appendChild(marker);

  els.prevAyah.disabled = state.session.ayahIndex === 0;
  els.nextAyah.disabled = state.session.ayahIndex >= surah.ayat.length - 1;
}

function toArabicNumber(num) {
  const digits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(num)
    .split("")
    .map((d) => digits[parseInt(d, 10)])
    .join("");
}

function nextAyah() {
  if (!state.session) return;
  const surah = surahs.find((s) => s.id === state.session.surahId);
  if (state.session.ayahIndex < surah.ayat.length - 1) {
    state.session.ayahIndex++;
    state.session.revealedWords = new Set();
    state.session.pointer = 0;
    saveState();
    renderAyah();
    setFeedback("msg.pressToRecite", "hint");
  }
}

function prevAyah() {
  if (!state.session) return;
  if (state.session.ayahIndex > 0) {
    state.session.ayahIndex--;
    state.session.revealedWords = new Set();
    state.session.pointer = 0;
    saveState();
    renderAyah();
    setFeedback("msg.pressToRecite", "hint");
  }
}

function setFeedback(key, type) {
  els.feedback.textContent = key ? t(key) : "";
  els.feedback.className = "feedback " + (type || "");
}

function updateReciteButton() {
  els.reciteBtn.classList.toggle("recording", state.isRecording);
  els.reciteBtn.setAttribute("aria-pressed", String(state.isRecording));
  const label = els.reciteBtn.querySelector(".recite-label");
  label.textContent = t(state.isRecording ? "button.stop" : "button.start");
}

function updateReciteButtonState() {
  const ready = !!state.asr;
  els.reciteBtn.disabled = !ready;
  els.reciteBtn.style.opacity = ready ? "1" : "0.5";
  if (!ready) {
    els.reciteBtn.title = t("msg.modelLoading");
  } else {
    els.reciteBtn.title = "";
  }
}

/* ==================== PROFILE ==================== */
function renderProfile() {
  els.nickname.value = state.profile.nickname || "";
  els.dailyTarget.value = state.profile.dailyTarget || 5;
  els.defaultLevel.value = state.profile.difficulty || 2;
}

function saveProfile(e) {
  e.preventDefault();
  state.profile.nickname = els.nickname.value.trim();
  state.profile.dailyTarget = parseInt(els.dailyTarget.value, 10) || 5;
  state.profile.difficulty = parseInt(els.defaultLevel.value, 10) || 2;
  saveState();
  setFeedback("", "");
  showView("select");
}

/* ==================== PROGRESS ==================== */
function renderProgress() {
  els.streakValue.textContent = state.streak.count;

  let totalAyat = 0;
  Object.values(state.progress).forEach((p) => {
    totalAyat += (p.completedAyat || []).length;
  });
  els.totalAyatValue.textContent = totalAyat;

  const todayStr = new Date().toISOString().split("T")[0];
  const todayCount = state.today.date === todayStr ? state.today.count : 0;
  els.todayProgressValue.textContent = todayCount;

  els.surahProgressList.innerHTML = "";
  surahs.forEach((surah) => {
    const sp = state.progress[surah.id];
    const total = surah.ayat.length;
    const completed = sp ? sp.completedAyat.length : 0;
    const pct = total > 0 ? (completed / total) * 100 : 0;

    const item = document.createElement("div");
    item.className = "surah-progress-item";
    item.innerHTML = `
      <div class="info">
        <div class="name">${surah.name}</div>
        <div class="meta">${completed}/${total} ${t("msg.completion")}</div>
      </div>
      <div class="progress-bar-mini">
        <div class="progress-bar-mini-fill" style="width:${pct}%"></div>
      </div>
    `;
    els.surahProgressList.appendChild(item);
  });
}

/* ==================== REVIEW SCHEDULER ==================== */
function needsReview() {
  const todayStr = new Date().toISOString().split("T")[0];
  if (state.review.date === todayStr) return false;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const yesterdayItems = state.review.items.filter((r) => r.date === yesterdayStr);
  return yesterdayItems.length > 0;
}

function checkReview() {
  if (needsReview()) {
    showView("review");
  }
}

function renderReview() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const items = state.review.items.filter((r) => r.date === yesterdayStr);

  if (items.length === 0) {
    els.reviewContent.innerHTML = `<p class="feedback success">${t("msg.reviewComplete")}</p>`;
    state.review.date = new Date().toISOString().split("T")[0];
    saveState();
    setTimeout(() => {
      els.reviewContent.innerHTML = "";
      showView("select");
    }, 1800);
    return;
  }

  els.reviewContent.innerHTML = "";
  items.forEach((item) => {
    const surah = surahs.find((s) => s.id === item.surahId);
    const div = document.createElement("div");
    div.className = "review-ayah-item";
    div.innerHTML = `
      <div class="review-header">${surah.name} — ${t("label.ayah")} ${toArabicNumber(item.ayahIndex + 1)}</div>
      <div class="review-text">${surah.ayat[item.ayahIndex].join(" ")}</div>
      <button class="review-btn" data-sid="${item.surahId}" data-aidx="${item.ayahIndex}">
        ${t("button.review")}
      </button>
    `;
    els.reviewContent.appendChild(div);
  });

  els.reviewContent.querySelectorAll(".review-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const sid = parseInt(e.currentTarget.getAttribute("data-sid"), 10);
      const aidx = parseInt(e.currentTarget.getAttribute("data-aidx"), 10);
      // Open in memorize view for actual recitation review
      // Item stays in review list until successfully recited
      startMemorization(sid, aidx, true);
    });
  });
}

function skipReview() {
  state.review.date = new Date().toISOString().split("T")[0];
  saveState();
  showView("select");
}

/* ==================== EVENTS ==================== */
function setupEventListeners() {
  els.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.getAttribute("data-view")));
  });

  els.langSwitcher.addEventListener("change", (e) => setLanguage(e.target.value));

  els.reciteBtn.addEventListener("click", () => {
    if (state.isRecording) stopRecording();
    else startRecording();
  });

  els.prevAyah.addEventListener("click", prevAyah);
  els.nextAyah.addEventListener("click", nextAyah);

  els.levelSelector.addEventListener("change", (e) => {
    if (state.session) {
      state.session.level = parseInt(e.target.value, 10);
      saveState();
    }
  });

  els.profileForm.addEventListener("submit", saveProfile);
  els.retryModelBtn.addEventListener("click", initASR);
  els.skipReviewBtn.addEventListener("click", skipReview);
}

/* ==================== LANGUAGE DETECTION ==================== */
function checkLanguage() {
  const savedLang = state.profile.language;
  const browserLang = (navigator.language || "en").split("-")[0];
  const supported = ["ar", "en", "ur", "id", "tr", "fr"];
  const lang = savedLang || (supported.includes(browserLang) ? browserLang : "en");
  state.lang = lang;
  els.langSwitcher.value = lang;
  loadTranslations(lang).then(() => applyTranslations());
}

/* ==================== INIT ==================== */
function init() {
  cacheElements();
  loadState();
  setupEventListeners();
  checkLanguage();

  if (state.session) {
    showView("memorize");
    renderAyah();
  } else if (needsReview()) {
    showView("review");
  } else {
    showView("select");
  }

  updateReciteButtonState();
  initASR();
}

// Register service worker for PWA
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((err) => {
    console.error("SW registration failed", err);
  });
}

init();
