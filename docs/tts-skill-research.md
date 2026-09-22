# URL-to-audio TTS skill: research

Research for [agent-config#279](https://github.com/dfadler/agent-config/issues/279): a
skill that takes a URL, pulls out the article text, and turns it into an audio file
with a voice the user picks. Nothing here is built or installed. Prices and limits
come from each vendor's own docs as of 2026-09. Local checks were read-only, on this
Mac (macOS 26.5).

## Content extraction

- **WebFetch won't work for this.** It turns the page into Markdown, runs a prompt
  over it with a small model, and gives Claude that model's answer rather than the
  page. Large pages are cut off before that step
  ([Claude Code tools reference](https://code.claude.com/docs/en/tools-reference#webfetch-tool-behavior)).
  A narration needs the article word for word, so the skill has to fetch the raw
  HTML with `curl`.
- **[trafilatura](https://trafilatura.readthedocs.io/en/latest/)** (Apache-2.0,
  Python) does readability-style main-text extraction. It has a CLI
  (`trafilatura -u <url>`) that outputs TXT or Markdown, and its docs report that it
  beats other open-source extractors on their benchmark. It is the best
  fit, and it costs one `pip install`.
- **[Readability.js](https://github.com/mozilla/readability)** (Apache-2.0) is the
  Firefox Reader View engine. Outside a browser it needs Node plus jsdom, with script
  execution left off. It also doesn't sanitize its output. That's more setup than
  trafilatura for the same job.
- **Zero-install fallback:** macOS `textutil -convert txt -stdin` (see `man textutil`)
  turns HTML into text, but it keeps the nav, footer, and other boilerplate. It's
  good enough when the reader view is already clean. It isn't good enough as the
  default.
- **Injection:** the extracted text is untrusted page content. The skill should send
  it to the TTS engine as data. Claude shouldn't read it as instructions, and only
  needs to look at it for chunking.

## TTS backends

| Backend | Cost | Voice selection | Per-request limit | Auth / install |
|---|---|---|---|---|
| **macOS `say`** | free | `-v <name>`: 184 voices installed here (43 en_*, 50 locales). `-r` rate in wpm. | none documented; `-f file` reads the whole article | none, already installed |
| **[Piper](https://github.com/OHF-Voice/piper1-gpl)** | free, local | `-m en_US-lessac-medium`-style models from [Hugging Face](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md), 38 languages | none documented; the [CLI](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md) reloads the model on every call and lists no rate flag | `pip install piper-tts` plus a voice download. GPL-3.0, and the project calls itself "personal use and research only". Each voice has its own license. |
| **[OpenAI](https://developers.openai.com/api/docs/guides/text-to-speech)** | `tts-1` [$15/1M chars](https://developers.openai.com/api/docs/models/tts-1), `tts-1-hd` [$30/1M](https://developers.openai.com/api/docs/models/tts-1-hd), `gpt-4o-mini-tts` [$0.60/1M text-in + $12/1M audio-out tokens](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts) | 13 named voices. `speed` 0.25–4.0. `instructions` (tone/accent; `gpt-4o-mini-tts` only) | [4096 chars](https://developers.openai.com/api/docs/api-reference/audio/createSpeech) (2000 tokens for `gpt-4o-mini-tts`) | `OPENAI_API_KEY`. The TTS guide says end users must be told the voice is AI-generated. |
| **[ElevenLabs](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)** | [$0.05–0.10/1K chars](https://elevenlabs.io/pricing/api) ($50–100/1M) | `voice_id` from a large library plus cloning. `voice_settings.speed`, `stability`, `style` | [5K (v3) to 40K (Flash v2.5) chars](https://elevenlabs.io/docs/models) | `xi-api-key` |
| **[Amazon Polly](https://aws.amazon.com/polly/pricing/)** | $4 standard / $16 neural / $30 generative / $100 long-form per 1M. Free tier: 5M standard/mo | `VoiceId`, SSML `<prosody>` | [3000 billed chars and 10 min audio (sync); 100K (async task)](https://docs.aws.amazon.com/polly/latest/dg/limits.html) | AWS credentials plus SDK/CLI |
| **[Google Cloud TTS](https://cloud.google.com/text-to-speech/pricing)** | Standard/WaveNet $4/1M (4M free/mo). Neural2 $16 and Chirp 3 HD $30 (1M free/mo each). Studio $160 | voice name plus SSML rate/pitch | not checked | GCP project plus service-account or gcloud auth |

For scale: a 10K-character article (about 10 minutes of audio, going by
[ElevenLabs' own ratio](https://elevenlabs.io/docs/models)) costs about $0.15 on
`tts-1`, $0.50–1.00 on ElevenLabs, and nothing on `say` or Piper. It's also inside
Google's and Polly's free tiers.

## Voice configuration

"Beyond the default" should mean a **named voice plus speed**, per call, since every
backend supports both. Pitch and accent only work on some backends: SSML on
Polly/Google, `instructions` on OpenAI, and picking a locale voice with `say`.
**Voice cloning** is ElevenLabs-only and brings consent questions, so leave it out.

UX: skill arguments (`voice=Samantha rate=200 backend=say`), with the defaults read
from env vars (`TTS_BACKEND`, `TTS_VOICE`). Add a config file only if env vars stop
being enough. Voice names differ by backend, so the skill should list them on request (`say -v '?'`, or OpenAI's fixed 13).

## Long articles and output

- `say -f article.txt -o out.m4a` handles a long article in one call and writes AAC
  directly (`man say`: `--file-format`, `--data-format`, `--bit-rate`). No chunking
  needed.
- API backends need chunking. Split on paragraph and then sentence boundaries under
  the backend's limit (4096 for OpenAI, 3000 for sync Polly), synthesize each chunk,
  and join them with `ffmpeg` (installed here at `/usr/local/bin/ffmpeg`). Polly's
  async task and ElevenLabs Flash (40K) can often take the whole article in one call.
- Output: `.m4a` (from `say`) or `.mp3` (from the APIs) at a predictable path. The
  skill prints that path.
  [`SendUserFile`](https://code.claude.com/docs/en/tools-reference) is only available
  with a Remote Control client or in a cloud session, so it's an optional extra, not
  the main way to deliver the file.

## Fit as a dfadler-agent-config skill

It fits. Nothing in it is specific to one project ([scope](./scope.md)). **No MCP or
new tool wiring is needed.** Bash with `curl`, an extractor, and a TTS CLI (or `curl`
to an API) covers it all. There should be no hook, because this is an on-demand
action. The skill has to degrade cleanly when a dependency or key is missing. It must
never echo API keys (the secrets-handling convention applies). Any `uvx`/`pipx run`
style invocation is a fetch-and-execute install, so it needs per-run permission
under `fetch-execute-guide`.

## Recommendation

**Local-first, with one optional API backend:**

1. **Default: `curl` → trafilatura → `say`.** `say` is already installed, costs
   nothing, has no documented length limit, offers 184 voices with rate control, and writes m4a
   directly. The only new dependency is trafilatura, and `textutil` covers the case
   where it's missing.
2. **Optional: OpenAI TTS** when `OPENAI_API_KEY` is set. It has the simplest auth of
   the APIs, a low price (`tts-1` about $0.15 per article), a real voice upgrade, and
   steerable delivery through `instructions`. It needs chunking at 4096 chars.
3. **Deferred:** Piper (license caveats plus a pip install and a model download, for
   a voice-quality gain nobody has measured against `say` yet), ElevenLabs (largest
   voice library, but 3–7× the cost of `tts-1`), and Polly/Google (cheap, but heavy cloud-credential setup for a personal skill).

## Open decision

- Is a Python dependency (trafilatura) acceptable for the default path, or should v1
  be strictly zero-install (`textutil`, with worse extraction)?
- Should v1 ship the OpenAI backend, or stay local-only until `say`'s voices prove
  not good enough?
