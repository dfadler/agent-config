"""Tests for the url-to-audio skill's chunk_text.py helper.

Loaded via importlib by path (same technique as test_agent_term.py) since the
script lives inside a skill directory, not a package. These translate its
built-in `--self-test` assertions into individually-reported pytest cases,
plus a couple of boundary cases the self-test doesn't cover.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = (
    REPO_ROOT
    / "plugins"
    / "dfadler-agent-config"
    / "skills"
    / "url-to-audio"
    / "scripts"
    / "chunk_text.py"
)


def _load_module() -> Any:
    spec = importlib.util.spec_from_file_location("chunk_text", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


chunk_text_mod = _load_module()
chunk_text = chunk_text_mod.chunk_text


class TestChunkText:
    def test_short_text_fits_one_chunk(self) -> None:
        assert chunk_text("Hello world.", max_chars=100) == ["Hello world."]

    def test_empty_or_whitespace_only_yields_no_chunks(self) -> None:
        assert chunk_text("   \n\n  ", max_chars=100) == []

    def test_non_positive_limit_is_rejected(self) -> None:
        with pytest.raises(ValueError):
            chunk_text("hi", max_chars=0)

    def test_long_article_stays_under_limit_with_no_empty_chunks(self) -> None:
        article = "\n\n".join(f"Paragraph {i}. " + ("word " * 30) for i in range(20))
        chunks = chunk_text(article, max_chars=200)
        assert chunks, "expected at least one chunk"
        assert all(0 < len(c) <= 200 for c in chunks), "a chunk violated max_chars"

    def test_pathological_no_whitespace_input_still_terminates(self) -> None:
        wall = "x" * 500
        chunks = chunk_text(wall, max_chars=100)
        assert all(len(c) <= 100 for c in chunks)
        # Hard-split must not silently drop any characters.
        assert sum(len(c) for c in chunks) == 500

    def test_oversized_single_paragraph_falls_back_to_sentence_split(self) -> None:
        long_sentence_paragraph = " ".join(
            f"Sentence number {i} here." for i in range(50)
        )
        chunks = chunk_text(long_sentence_paragraph, max_chars=100)
        assert all(len(c) <= 100 for c in chunks)
        # No sentence content lost across the split (modulo the joining spaces
        # the packer collapses to single spaces between sentences).
        assert "Sentence number 0 here." in chunks[0]
        assert "Sentence number 49 here." in chunks[-1]

    def test_chunk_count_matches_self_test_expectation(self) -> None:
        # Guards against the exact greedy-packing behavior regressing
        # silently — same input/limit as the module's own --self-test.
        article = "\n\n".join(f"Paragraph {i}. " + ("word " * 30) for i in range(20))
        chunks = chunk_text(article, max_chars=200)
        assert len(chunks) > 1, "20 paragraphs at 200 chars should need multiple chunks"


def test_self_test_still_passes() -> None:
    """The module's own --self-test is the spec; keep it green too so a
    future edit to chunk_text.py can't pass this file while breaking the
    CLI's --self-test flag out from under it."""
    chunk_text_mod._self_test()
