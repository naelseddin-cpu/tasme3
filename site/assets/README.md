# Certificate background artwork

Drop ornamental certificate background images here — the app discovers them
automatically at runtime, with **no code changes needed**. See
`site/certificate.js`'s `loadTemplates()` for the exact probe logic.

## Expected filenames

Numbered templates, tried in order, up to 6:

```
certificate-bg-1.webp   (or .png / .jpg — first that loads wins, per slot)
certificate-bg-2.webp
certificate-bg-3.webp
certificate-bg-4.webp
certificate-bg-5.webp
certificate-bg-6.webp
```

Each slot is independent — you can add just `certificate-bg-1.*` today and
`certificate-bg-2.*` later; missing slots are simply skipped (a 404 there
is expected and harmless).

If **none** of the numbered slots exist, the app falls back to a single
legacy file:

```
certificate-bg.webp   (or .png / .jpg)
```

If **nothing** exists yet, certificates render with a clean drawn fallback
design (cream ground, gold double border, corner flourishes) — the feature
works correctly with zero files in this folder.

## Design spec

- **Orientation:** portrait, roughly 4:3-ish tall (matches the app's
  1080×1528 certificate canvas — a wider/taller image is fine, it's drawn
  cover-fit).
- **Clear center panel:** leave the central ~70% width / ~55% height of the
  image clear/uncluttered — that's where the certificate text (basmala,
  title, name, surah, date) gets overlaid. Dark green/gold text is used, so
  a light (cream/pale) center panel reads best.
- **Style:** ornate Islamic illumination frame (green/gold), no photos of
  people, no Quranic verse text baked into the artwork (verse text on
  generated/designed graphics is against project policy — the basmala and
  any Quranic wording are drawn by the app itself, in the verified font,
  not part of the background image).
- **Rotation:** with N template files present, surah number `s` always
  renders with template `((s - 1) % N) + 1` — deterministic, so a given
  surah's certificate always looks the same to the person who earned it.
