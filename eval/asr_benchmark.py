"""ASR benchmark: WER, CER and speed (real-time factor) per model and language. Use it to choose
ASR_MODEL / ASR_DEVICE / ASR_COMPUTE_TYPE (decision D11).

    cd backend          # needs: pip install -e ".[asr,eval]"
    .venv/bin/python ../eval/asr_benchmark.py --manifest ../eval/data/manifest.jsonl \
        --model small --model medium --device cpu --compute-type int8

The manifest is JSON Lines, with paths relative to the manifest file:

    {"audio": "hi/0001.wav", "reference": "आज हम प्रक्रिया शेड्यूलिंग पढ़ेंगे", "language": "hi"}
    {"audio": "te/0001.wav", "reference_file": "te/0001.txt", "language": "te"}

Any format ffmpeg/PyAV can read works; audio is resampled to 16 kHz mono. The transcriber is the
production adapter (worker.asr.transcriber), with the same VAD and decoding options. The
language is fixed per item, as in live mode (D6), unless --auto-language is given.

RTF = processing time / audio duration. Below 1.0 is faster than real time. For live use on a
shared CPU, aim for an RTF of at most about 0.3 per concurrent classroom.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from metrics import error_rates, utf8_stdio

SAMPLE_RATE = 16_000


@dataclass(frozen=True)
class Item:
    audio: Path
    reference: str
    language: str


@dataclass
class Bucket:
    refs: list[str] = field(default_factory=list)
    hyps: list[str] = field(default_factory=list)
    elapsed_s: float = 0.0
    audio_s: float = 0.0


def read_manifest(path: Path) -> list[Item]:
    items: list[Item] = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        row = json.loads(line)
        if "reference" in row:
            reference = str(row["reference"])
        elif "reference_file" in row:
            reference = (path.parent / row["reference_file"]).read_text(encoding="utf-8")
        else:
            raise ValueError(f"{path}:{n}: needs 'reference' or 'reference_file'")
        audio = path.parent / row["audio"]
        if not audio.is_file():
            raise FileNotFoundError(f"{path}:{n}: {audio} not found")
        items.append(Item(audio, reference, str(row.get("language", "en"))))
    if not items:
        raise ValueError(f"{path} has no items")
    return items


def run_model(
    items: list[Item],
    model: str,
    device: str,
    compute_type: str,
    beam: int,
    auto_language: bool,
    fold_nasals: bool,
) -> dict[str, object]:
    from faster_whisper import decode_audio

    from worker.asr.transcriber import FasterWhisperTranscriber

    load_start = time.perf_counter()
    transcriber = FasterWhisperTranscriber(model, device, compute_type)
    load_s = time.perf_counter() - load_start

    by_language: dict[str, Bucket] = {}
    for item in items:
        audio = decode_audio(str(item.audio), sampling_rate=SAMPLE_RATE)
        start = time.perf_counter()
        words = transcriber.transcribe(
            audio, language=None if auto_language else item.language, prompt=None, beam_size=beam
        )
        elapsed = time.perf_counter() - start
        hypothesis = "".join(w.text for w in words).strip()
        bucket = by_language.setdefault(item.language, Bucket())
        bucket.refs.append(item.reference)
        bucket.hyps.append(hypothesis)
        bucket.elapsed_s += elapsed
        bucket.audio_s += len(audio) / SAMPLE_RATE
        print(
            f"  [{model}] {item.audio.name}: {elapsed:.1f}s for {len(audio) / SAMPLE_RATE:.1f}s audio",
            file=sys.stderr,
        )

    languages: dict[str, object] = {}
    for language, b in sorted(by_language.items()):
        languages[language] = {
            **error_rates(b.refs, b.hyps, fold_nasals=fold_nasals).as_dict(),
            "items": len(b.refs),
            "audio_s": round(b.audio_s, 1),
            "rtf": round(b.elapsed_s / b.audio_s, 3) if b.audio_s else None,
        }
    return {
        "model": transcriber.name,
        "beam": beam,
        "language_mode": "auto" if auto_language else "fixed",
        "load_s": round(load_s, 1),
        "languages": languages,
    }


def main() -> int:
    utf8_stdio()
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument(
        "--model", action="append", required=True, help="e.g. small, medium, large-v3 (repeatable)"
    )
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument(
        "--beam", type=int, default=5, help="5 = finalisation (BATCH_BEAM), 1 = live (LIVE_BEAM)"
    )
    parser.add_argument("--auto-language", action="store_true")
    parser.add_argument("--fold-nasals", action="store_true", help="treat chandrabindu and anusvara as equal")
    parser.add_argument("--out", type=Path, default=None, help="default: eval/results/asr-<UTC time>.json")
    args = parser.parse_args()

    items = read_manifest(args.manifest)
    results = [
        run_model(items, m, args.device, args.compute_type, args.beam, args.auto_language, args.fold_nasals)
        for m in args.model
    ]

    print(f"\n{'model':38} {'lang':5} {'WER':>7} {'CER':>7} {'RTF':>6} {'audio s':>8}")
    for r in results:
        languages = r["languages"]
        assert isinstance(languages, dict)
        for language, s in languages.items():
            rates = f"{s['wer']:>7.3f} {s['cer']:>7.3f} {s['rtf']!s:>6} {s['audio_s']:>8}"
            print(f"{r['model']!s:38} {language:5} {rates}")

    out = args.out or Path(__file__).parent / "results" / f"asr-{datetime.now(UTC):%Y%m%dT%H%M%SZ}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"manifest": str(args.manifest), "results": results}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\nwritten: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
