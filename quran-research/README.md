# Quran research tools

Analysis tools built on the official KFGQPC text in `tools/data/quran.json`
plus the word-by-word morphology of the Quranic Arabic Corpus.

## Get the morphology file (not committed)

    curl -o morph.txt https://raw.githubusercontent.com/mustafa0x/quran-morphology/master/quran-morphology.txt

## Explorer (3D interactive page)

    python3 build_data.py ../tools/data/quran.json morph.txt explorer   # writes data.json + text.json
    cd explorer && python3 -m http.server   # open http://localhost:8000

`explorer/index.html` is published as a claude.ai artifact; the "الحكمة" view
asks Claude (artifact `sample` capability) and only works inside claude.ai.

## Root report (رزق)

    python3 report/build.py ../tools/data/quran.json report/rizq-report.html report/template.html

Every ayah is pulled verbatim from `quran.json`; the scripts fail if a count or
highlighted phrase does not match the text.
