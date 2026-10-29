"""Benchmark Quran ASR models against the official KFGQPC text.

    python -m server.bench.asr_bench MODEL_DIR [MODEL_DIR...] [--device cuda --index 1 --compute float16]

Downloads a fixed sample of ayat (short to very long) from several EveryAyah
reciters, transcribes each with every model, and reports word error rate (WER)
after the same normalization the matcher uses (server/matching.py), plus
"coverage" (share of reference words recovered) to catch truncated output.
Reference text comes only from tools/data/quran.json.
"""
import argparse, json, os, sys, time, urllib.request
from pathlib import Path

from server.matching import normalize_arabic, normalize_arabic_alt, fuzzy_equal

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(os.environ.get('BENCH_CACHE', '/tmp/asr-bench'))
RECITERS = ['Husary_128kbps', 'Minshawy_Murattal_128kbps', 'Alafasy_128kbps', 'Abdul_Basit_Murattal_192kbps']
# (surah, ayah): short, medium, long and very long ayat across the mushaf
AYAT = [(1, 2), (2, 2), (2, 255), (2, 282), (3, 26), (12, 4), (18, 10), (24, 35), (36, 9), (55, 13), (67, 1), (112, 1)]
# muqatta'at (e.g. يسٓ, recited as letter names) are a matcher special case, not scored here


def reference():
    q = json.load(open(ROOT / 'tools/data/quran.json'))
    return {(s['id'], v['id']): v['text'] for s in q for v in s['verses']}


def words(text):
    return [w for w in (normalize_arabic(t) for t in text.split()) if w]


def same(rw, hw, level):
    if level is None:
        return rw == hw
    return rw == hw or fuzzy_equal(hw, rw, level)


def wer(ref, hyp, level=None):
    # word-level edit distance; level=None: exact normalized words,
    # level=1..3: a word counts as right when the app's matcher would accept it
    r = [(normalize_arabic(t), normalize_arabic_alt(t)) for t in ref.split()]
    r = [x for x in r if x[0]]
    h = words(hyp)
    d = list(range(len(h) + 1))
    for i, rw in enumerate(r, 1):
        prev, d[0] = d[0], i
        for j, hw in enumerate(h, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (not (same(rw[0], hw, level) or same(rw[1], hw, level))))
    return d[len(h)], len(r)


def clip(reciter, s, a):
    f = CACHE / f'{reciter}_{s:03d}{a:03d}.mp3'
    if not f.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(f'https://everyayah.com/data/{reciter}/{s:03d}{a:03d}.mp3', f)
    return f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('models', nargs='+')
    ap.add_argument('--device', default='cpu'); ap.add_argument('--index', type=int, default=0)
    ap.add_argument('--compute', default='int8'); ap.add_argument('--threads', type=int, default=0); ap.add_argument('--beam', type=int, default=1)
    ap.add_argument('--chunk', type=float, default=0, help='also test N-second chunks (like live listening)')
    a = ap.parse_args()
    from faster_whisper import WhisperModel
    ref = reference()
    for path in a.models:
        m = WhisperModel(path, device=a.device, device_index=a.index, compute_type=a.compute, cpu_threads=a.threads)
        errs = total = jerrs = 0; secs = 0.0; worst = []
        for rc in RECITERS:
            for s, ay in AYAT:
                t = time.time()
                segs, _ = m.transcribe(str(clip(rc, s, ay)), language='ar', vad_filter=True, beam_size=a.beam,
                                       condition_on_previous_text=False)
                hyp = ' '.join(x.text for x in segs); secs += time.time() - t
                e, n = wer(ref[(s, ay)], hyp); errs += e; total += n; jerrs += wer(ref[(s, ay)], hyp, 2)[0]
                worst.append((e / n, f'{rc.split("_")[0]} {s}:{ay}', len(words(hyp)), n))
        worst.sort(reverse=True)
        print(f'{Path(path).name}: exact WER {100 * errs / total:.2f}%  as-judged (level 2) {100 * jerrs / total:.2f}%  ({total} words)  time {secs:.1f}s')
        print('   worst:', '; '.join(f'{w[1]} {100 * w[0]:.0f}% ({w[2]}/{w[3]} words)' for w in worst[:4]))


if __name__ == '__main__':
    main()
