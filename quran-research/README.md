# Quran research tools

Analysis tools built on the official KFGQPC text in `tools/data/quran.json`
plus the word-by-word morphology of the Quranic Arabic Corpus.

## Get the morphology file (not committed)

    curl -o morph.txt https://raw.githubusercontent.com/mustafa0x/quran-morphology/master/quran-morphology.txt

## Explorer (3D interactive page)

    python3 build_data.py ../tools/data/quran.json morph.txt explorer   # writes data.json + text.json
    python3 server.py   # open http://localhost:8000

Arabic-native and mobile-first (most users are on phones). Home is a cinematic
scroll hero; "الفضاء" shows every root as a planet (warm = mostly Meccan, cool =
mostly Medinan, size = occurrences, rings = the 12 most frequent) whose moons are
its lemmas, with the written forms as satellites. Reading pages use a parchment theme.

`server.py` serves the site and the "الحكمة" chat: the owner (this PC, the home
network, or the password in `.chat-password`) gets the Claude CLI; public visitors
get the local llama.cpp Gemma server on port 8092. Inside claude.ai the page uses
the artifact `sample` capability instead.

## Running it permanently (public)

`deploy/` has two systemd user services: the site, and a free Cloudflare quick
tunnel that gives it a public HTTPS address (it changes on every restart):

    cp deploy/quran-*.service ~/.config/systemd/user/
    systemctl --user enable --now quran-explorer quran-tunnel
    sudo loginctl enable-linger $USER     # start at boot without logging in
    deploy/public-url.sh                  # print the current public address

Memorization (التحفيظ): the same site serves the repo's تسميع PWA (`../site`) at
`/hifz/` and proxies its recognition + accounts server (`../server`) at `/hifz-api`.
That server runs as `deploy/tasme3-api.service` with the Quran-tuned Whisper
(`tarteel-ai/whisper-base-ar-quran`, converted once to CTranslate2 into
`server/models/`, see `server/RUNBOOK.md`) on the GPU:

    cp deploy/tasme3-api.service ~/.config/systemd/user/
    systemctl --user enable --now tasme3-api

## Design (all artwork from Nano Banana)

Every image in `explorer/img/` was generated with Nano Banana Pro through the
Gemini web app (Google AI Pro plan, no paid API): `design/raw/` keeps the
originals, `design/prompts/` the prompts, `design/gemini_web.py` the headless
Firefox driver (it runs over a copy of a signed-in Firefox profile). Every image is
checked for invented script: Quran text is never generated. The site's JPGs are
made from the originals with PIL.

## Root report (رزق)

    python3 report/build.py ../tools/data/quran.json report/rizq-report.html report/template.html

Every ayah is pulled verbatim from `quran.json`; the scripts fail if a count or
highlighted phrase does not match the text.
