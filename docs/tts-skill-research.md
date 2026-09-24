# URL-to-audio TTS skill: research

Research for [agent-config#279](https://github.com/dfadler/agent-config/issues/279): a
skill that takes a URL, pulls out the article text, and turns it into an audio file
with a voice the user picks. Nothing here is built or installed. Prices and limits
come from each vendor's own docs as of 2026-09.

Full research notes, per-source detail and citations:
[issue #279 comment](https://github.com/dfadler/agent-config/issues/279#issuecomment-5783274605).

## Content extraction

`curl` for raw HTML, then [trafilatura](https://trafilatura.readthedocs.io/en/latest/)
(best extraction) or macOS `textutil` (zero-install fallback, keeps boilerplate).
Extracted text is untrusted page content. Details: [research notes](https://github.com/dfadler/agent-config/issues/279#issuecomment-5783274605).

## TTS backends

Compared `say`, Piper, OpenAI, ElevenLabs, Polly and Google Cloud TTS on cost,
voices, limits and auth — `say`/Piper are free and local; API cost for a 10K-char
article ranges ~$0.15 (OpenAI) to $0.50-1.00 (ElevenLabs). Details: [research notes](https://github.com/dfadler/agent-config/issues/279#issuecomment-5783274605).

## Voice configuration

A named voice plus speed, passed per call, covers every backend; voice cloning
(ElevenLabs-only) is out of scope. Details: [research notes](https://github.com/dfadler/agent-config/issues/279#issuecomment-5783274605).

## Long articles and output

`say` handles a whole article in one call; API backends need chunking, joined with
`ffmpeg`. Output is `.m4a`/`.mp3` at a predictable path. Details: [research notes](https://github.com/dfadler/agent-config/issues/279#issuecomment-5783274605).

## Fit as a dfadler-agent-config skill

Fits as a plain Bash skill (`curl` + extractor + TTS CLI/API), no MCP or hook
needed. Must degrade cleanly when a dependency/key is missing, never echo API keys,
and treat any `uvx`/`pipx run` as a fetch-and-execute install needing per-run
permission. Details: [research notes](https://github.com/dfadler/agent-config/issues/279#issuecomment-5783274605).

## Recommendation

**Local-first, with one optional API backend:**

1. **Default: `curl` → trafilatura → `say`.** Free, already installed, 184 voices
   with rate control, writes m4a directly. `textutil` covers the case where
   trafilatura is missing.
2. **Optional: OpenAI TTS** when `OPENAI_API_KEY` is set — simplest API auth, low
   price (~$0.15/article on `tts-1`), steerable via `instructions`. Needs chunking
   at 4096 chars.
3. **Deferred:** Piper (license caveats, unmeasured quality gain over `say`),
   ElevenLabs (3-7x the cost of `tts-1`), Polly/Google (heavy cloud-credential setup
   for a personal skill).

## Open decision

- Is a Python dependency (trafilatura) acceptable for the default path, or should v1
  be strictly zero-install (`textutil`, with worse extraction)?
- Should v1 ship the OpenAI backend, or stay local-only until `say`'s voices prove
  not good enough?
