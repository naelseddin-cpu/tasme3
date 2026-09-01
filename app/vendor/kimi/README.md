# Quran Memorization Trainer

A free charity web app that helps people memorize the Quran by reciting aloud. The app listens through the microphone, checks the recitation against the known Quran text, and reveals each word on screen only when recited correctly. Wrong or missed words stay hidden so the user retries.

## Features

- **On-device speech recognition** using Whisper via transformers.js — no audio leaves the browser
- **Mushaf-like display** with full Arabic tashkeel, Amiri Quran font, and cream/gold styling
- **Three difficulty levels** (Beginner / Intermediate / Precise) with adjustable fuzzy-matching tolerance
- **Multilingual UI** (Arabic, English, Urdu, Indonesian, Turkish, French) with RTL/LTR support
- **Progress tracking** — per-surah completion, daily streak, and total verses memorized
- **Review-first spaced repetition** — each day you review yesterday’s verses before new memorization
- **Fully offline PWA** — works without internet after first visit (the ASR model is cached by the browser)
- **No backend, no accounts, no API keys** — all data stays in localStorage

## Hosting

This is a static site. Upload all files to any static host:

- GitHub Pages
- Netlify Drop
- Vercel (static)
- Cloudflare Pages
- Apache / Nginx
- Any CDN or static file host

Serve the folder root so that `index.html` is accessible at `/` (or configure your host’s fallback to `index.html`).

### File structure

```
/
├── index.html
├── style.css
├── app.js
├── matcher.js
├── quran-data.js
├── manifest.json
├── sw.js
├── i18n/
│   ├── ar.json
│   ├── en.json
│   ├── ur.json
│   ├── id.json
│   ├── tr.json
│   └── fr.json
└── README.md
```

## Browser Requirements

- A modern browser with **MediaRecorder** and **Web Audio API** support (Chrome 49+, Safari 14.1+, Edge 79+, Firefox 25+)
- **Microphone permission** is required for recitation checking
- The speech-recognition model downloads on first use (~150 MB) and is cached for offline use

## Privacy

- All audio is processed **100% on-device**
- No audio, transcripts, or personal data are uploaded to any server
- All progress is stored locally in your browser via `localStorage`

## Adding More Surahs

Open `quran-data.js` and append a new surah object to the `surahs` array:

```javascript
{
  id: 2,
  name: "البقرة",
  englishName: "Al-Baqarah",
  ayat: [
    ["الم", "ذَلِكَ", "الْكِتَابُ", "لَا", "رَيْبَ", "فِيهِ"],
    // ... more ayat
  ]
}
```

Each ayah is an array of space-separated words. The app will automatically pick it up.

## License

This project is offered as a **free charity (ṣadaqa)** for the benefit of the Ummah. Use it, host it, and share it freely.
