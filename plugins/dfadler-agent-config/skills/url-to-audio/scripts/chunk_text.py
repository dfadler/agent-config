#!/usr/bin/env python3
"""Split article text into chunks under a character limit, for TTS backends
(OpenAI's audio/speech endpoint) that cap input length per request — 4096
chars for tts-1/tts-1-hd, 2000 tokens for gpt-4o-mini-tts (see
https://platform.openai.com/docs/api-reference/audio/createSpeech). Not
needed for the default `say` backend, which handles a whole article in one
call.

Greedy bin-packing, paragraph first, then sentence, then a hard split as a
last resort for a single run of text longer than the limit on its own (e.g.
no whitespace at all) — good enough for narration, where a chunk boundary
just becomes a small gap in a concatenated audio file, not a place that needs
to reconstruct byte-for-byte.

Usage:
    chunk_text.py <input.txt> <output_dir> [--max-chars N]
    chunk_text.py --self-test

Writes chunk_0001.txt, chunk_0002.txt, ... to output_dir and prints one path
per line, in order, for the caller to loop over.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

DEFAULT_MAX_CHARS = 4096

_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _pack(units: list[str], max_chars: int, sep: str) -> list[str]:
    """Greedily pack `units` (already each <= max_chars) into chunks joined
    by `sep`, never exceeding max_chars per chunk."""
    chunks: list[str] = []
    buf = ""
    for unit in units:
        if not buf:
            buf = unit
        elif len(buf) + len(sep) + len(unit) <= max_chars:
            buf = buf + sep + unit
        else:
            chunks.append(buf)
            buf = unit
    if buf:
        chunks.append(buf)
    return chunks


def _hard_split(text: str, max_chars: int) -> list[str]:
    return [text[i : i + max_chars] for i in range(0, len(text), max_chars)]


def _split_oversized(unit: str, max_chars: int) -> list[str]:
    """A single sentence (or paragraph with no sentence breaks) longer than
    max_chars on its own: fall back to sentence splitting, then a hard
    character split as the last resort."""
    sentences = [s for s in _SENTENCE_SPLIT.split(unit) if s.strip()]
    if len(sentences) > 1:
        pieces: list[str] = []
        for s in sentences:
            pieces.extend([s] if len(s) <= max_chars else _hard_split(s, max_chars))
        return _pack(pieces, max_chars, " ")
    return _hard_split(unit, max_chars)


def chunk_text(text: str, max_chars: int = DEFAULT_MAX_CHARS) -> list[str]:
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")

    paragraphs = [p for p in _PARAGRAPH_SPLIT.split(text) if p.strip()]
    if not paragraphs:
        return []

    units: list[str] = []
    for p in paragraphs:
        if len(p) <= max_chars:
            units.append(p)
        else:
            units.extend(_split_oversized(p, max_chars))

    return _pack(units, max_chars, "\n\n")


def _self_test() -> None:
    # Short text fits in one chunk.
    assert chunk_text("Hello world.", max_chars=100) == ["Hello world."]

    # Every chunk stays under the limit, even for a long multi-paragraph
    # article, and no chunk is empty.
    article = "\n\n".join(f"Paragraph {i}. " + ("word " * 30) for i in range(20))
    chunks = chunk_text(article, max_chars=200)
    assert chunks, "expected at least one chunk"
    assert all(0 < len(c) <= 200 for c in chunks), "a chunk violated max_chars"

    # A single run of text with no paragraph or sentence breaks at all (e.g.
    # one giant "word") still terminates and respects the limit, rather than
    # looping forever or returning it whole.
    wall = "x" * 500
    chunks = chunk_text(wall, max_chars=100)
    assert all(len(c) <= 100 for c in chunks)
    assert sum(len(c) for c in chunks) == 500

    # Empty / whitespace-only input yields no chunks.
    assert chunk_text("   \n\n  ", max_chars=100) == []

    # A non-positive limit is rejected rather than silently misbehaving.
    try:
        chunk_text("hi", max_chars=0)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for max_chars=0")

    print("self-test OK")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", help="Path to the text file to chunk")
    parser.add_argument(
        "output_dir", nargs="?", help="Directory to write chunk_NNNN.txt files into"
    )
    parser.add_argument("--max-chars", type=int, default=DEFAULT_MAX_CHARS)
    parser.add_argument(
        "--self-test", action="store_true", help="Run the built-in self-test and exit"
    )
    args = parser.parse_args(argv)

    if args.self_test:
        _self_test()
        return 0

    if not args.input or not args.output_dir:
        parser.error("input and output_dir are required unless --self-test is given")

    text = Path(args.input).read_text(encoding="utf-8")
    chunks = chunk_text(text, max_chars=args.max_chars)
    if not chunks:
        print("error: no text to chunk (empty input)", file=sys.stderr)
        return 1

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, chunk in enumerate(chunks, start=1):
        path = out_dir / f"chunk_{i:04d}.txt"
        path.write_text(chunk, encoding="utf-8")
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
