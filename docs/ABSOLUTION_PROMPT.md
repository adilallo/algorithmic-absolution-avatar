# Absolution prompt (ALG-14)

How the kiosk turns a punched **FORM 1517-A** into the spoken absolution the avatar reads aloud.
This is the prompt-configuration layer only — the punch-card sensor/orchestrator (ALG-13) is
separate and just tells us *which categories were punched*.

**Lives in:** [`deploy/tts-proxy/absolution.js`](../deploy/tts-proxy/absolution.js) — `CATEGORIES`,
`SYSTEM_PROMPT`, `buildUserPrompt()`, `normalizeTotals()`. Served by `POST /absolution`
(see [the proxy README](../deploy/tts-proxy/README.md)). Keep this doc and `CATEGORIES` in sync.

## Design in one line

**Send the declared harms to the LLM and speak its response back — with no system prompt at all
(current experiment).** Only the list of punched harms goes to the model; it responds however it
responds, and `cleanForSpeech` (strip markup + 1,800-char cap) plus the refusal guard are the only
backstops. The avatar reads the declared harms back and speaks a holding line *first*, to fill the
wait (see [Avatar flow](#avatar-flow)). No offsets, no scripted structure, no persona — per the
artist's direction: just combine the selections and let the model respond.

The word **"absolution"/"absolve" is kept out** of everything sent to the model — verified live that
asking Magisterium to "issue absolution" triggers its "only an ordained priest can absolve" refusal
(see [Magisterium / portability](#magisterium--portability)).

It's **LLM-agnostic** — nothing sent to the model is vendor-specific.

## Input contract

The punch card is **boolean**: a visitor punches any subset of the ten categories (no counts).
`normalizeTotals()` maps whatever the orchestrator sends to the canonical list — deduped, in
schedule order — and ignores unknown keys. Any count/flag is read as a boolean (truthy / `>0` =
punched). Accepted shapes:

```jsonc
{ "punched": ["taking_more_than_needed", "benefiting_from_underpaid_labor"] } // canonical ids (recommended)
[1, 5, 9]                                                                      // 1-based schedule indices
{ "categories": ["Taking more than needed", "Pricing what should not be sold"] } // labels (case/space-insensitive)
{ "taking_more_than_needed": true, "consuming_faster_than_things_renew": 1 }   // flat map
```

## The ten categories

Verbatim from the card, in schedule order. `CATEGORIES` in `absolution.js` is the single source of
truth for the card wording and the normalizer.

| # | id | Category (label) |
|---|----|------------------|
| 1 | `taking_more_than_needed` | TAKING MORE THAN NEEDED |
| 2 | `using_more_than_your_share` | USING MORE THAN YOUR SHARE |
| 3 | `letting_others_bear_the_cost` | LETTING OTHERS BEAR THE COST |
| 4 | `undervaluing_care_given_to_you` | UNDERVALUING CARE GIVEN TO YOU |
| 5 | `benefiting_from_underpaid_labor` | BENEFITING FROM UNDERPAID LABOR |
| 6 | `claiming_what_belongs_to_many` | CLAIMING WHAT BELONGS TO MANY |
| 7 | `wanting_what_was_sold_to_you` | WANTING WHAT WAS SOLD TO YOU |
| 8 | `pricing_what_should_not_be_sold` | PRICING WHAT SHOULD NOT BE SOLD |
| 9 | `consuming_faster_than_things_renew` | CONSUMING FASTER THAN THINGS RENEW |
| 10 | `inheriting_advantage_you_did_not_earn` | INHERITING ADVANTAGE YOU DID NOT EARN |

## System prompt

**Empty (`SYSTEM_PROMPT = ''`) — because magisterium-1 IGNORES the system message.** Verified
2026-06-17: a system prompt instructing *"ignore the user, reply only with the word ACKNOWLEDGED"*
still returned a 4,865-char cited essay. The model answers the user query and disregards the system
role, so any instruction it must obey — including brevity — has to live in the **user message** (see
below). The `SYSTEM_PROMPT` conditional in `getAbsolution()` is kept only for portability to a model
that *does* honor system prompts.

## User message

The declared harms **plus the `BREVITY` directive** (`buildUserPrompt()`) — the user message is the only
place magisterium-1 obeys instructions, so the directive is appended here. Two directives are defined;
`BREVITY` selects the active one:

- **`BREVITY_VIVID` (active):** *"Respond in two or three sentences: name in one striking phrase what
  these harms share, give one concrete image, and anchor it with a single memorable quotation from
  scripture or the Church. No headings or lists."* — brief but permits citation; draws out fresh
  per-card imagery + a quote (verified: a bakery whose ovens never cool; a neighborhood well locked and
  sold by the cup). ~300–500 chars, `finish_reason: stop`.
- **`BREVITY_PLAIN` (fallback):** *"Respond in no more than two or three sentences. Do not use headings
  or lists, and do not quote or cite sources."* — dry, no quotes/imagery. Revert here if the vivid one
  drifts long or off-tone.

```
A card was submitted declaring these categories of harm:
- BENEFITING FROM UNDERPAID LABOR
- PRICING WHAT SHOULD NOT BE SOLD

Respond in two or three sentences: name in one striking phrase what these harms share, give one concrete image, and anchor it with a single memorable quotation from scripture or the Church. No headings or lists.
```

(Blank card swaps the harm list for "A card was submitted declaring no category of harm." and appends
the same directive.) The directive must not contain the
word "absolution"/"absolve" (refusal trigger). Tune the sentence count there to trade length for
completeness — a "one sentence, 30 words" variant yields ~170 chars; "two or three sentences" a short
paragraph.

## Avatar flow

`window.requestAbsolution(punched)` (in `index.html`) drives the spoken sequence:

1. **Read-back + holding line, spoken immediately** — e.g. *"Your card has been received and is being
   processed. You have declared the following: benefiting from underpaid labor, and inheriting
   advantage you did not earn."* TalkingHead's `speakText` queues, so this plays *while the LLM call
   is in flight*, filling the ~25 s Magisterium wait instead of dead silence.
2. **The LLM response**, spoken when it arrives (queued after the preamble).

The harm labels for the read-back are resolved client-side from `GET /absolution/categories`
(best-effort; a blank card reads "you have declared no category of harm").

## Length & structure

The **`BREVITY` directive in the user message** (two–three sentences) is the primary length control —
the model returns a short, *complete* answer (`finish_reason: stop`), not a truncated one. Note no
Magisterium request parameter controls verbosity/length/citations (the docs expose only `max_tokens`,
`return_related_questions`, and input-only `safety_settings`; citations come back in a separate
`citations` array), so the user-message instruction is the only non-truncating lever. The backstops
remain in case it ignores the instruction: `cleanForSpeech` strips markup, lists, citations, and
footnotes, then hard-caps at a sentence boundary under **1,800 chars** (`ABSOLUTION_MAX_SPOKEN_CHARS`,
kept under the `/tts` 2,000-char gate, over which TTS 400s → silence), and `max_tokens` (320) bounds
the visible answer. These are safety nets, not the brevity mechanism — with the directive in place a
reply normally lands well under them.

## Determinism (for a gallery)

The model now authors the wording, so output varies per call. Knobs:

- **Temperature `0.4`** (`ABSOLUTION_TEMPERATURE`) — keeps variation modest.
- **Per-submission fallback cache (implemented).** The live Magisterium call stays **primary**; the
  cache is a *fallback* used only when a live call fails (error / timeout / connection loss / refusal
  / over-cap). The input space is exactly `2^10 = 1024` subsets (incl. the blank card), keyed
  **order-independently** by `fallbackKey()` (ids sorted alphabetically, so `{A,B} === {B,A}`). It is
  populated **lazily (write-on-success)**: every successful live response calls `saveBaked()`, storing
  its cleaned text in `absolution-fallbacks.json` — so the cache fills from real visits at **zero extra
  API cost**, and a card that errors after having been served once speaks its own tailored line instead
  of generic canned. A card not yet seen falls back to the generic `CANNED` rotation. The file is
  gitignored runtime state (and lives in the proxy dir, which is never web-served).
- **Optional pre-warm:** `bake-fallbacks.js` can generate any/all of the 1024 tuples up front
  (resumable; `BAKE_LIMIT`/`BAKE_CONCURRENCY` env). It hits Magisterium directly (bypassing the proxy
  day-cap) and uses the same `buildUserPrompt` + `cleanForSpeech`, so pre-warmed entries are identical
  to what a live visit would have cached. Baking all 1024 is ~14M tokens (RAG-dominated) — weigh
  against the live path's quota.
- **Guardrails on every live / cache-miss call** (in `absolution.js`): `cleanForSpeech` strip-and-cap;
  the refusal guard (`ABSOLUTION_REFUSAL_GUARD`) swaps a refusal/role-break for the fallback; any
  failure routes through `bakedFallback()` → baked line if present, else generic canned, so the ritual
  never stalls.

## No personal data

- The only input is the set of punched category labels — no name, no counts that could fingerprint
  a bearer, and the card's "specify, if you wish; this field is not read" line is never passed in.
- With no system prompt these aren't model-*instructed*, but the safeguard is structural: the only
  thing sent is the anonymous list of category labels, so there is nothing personal to leak or
  invent. (If a system prompt is reinstated, restore its "no name / no invented detail / no record
  kept" lines.)
- A pre-bake cache is keyed on the anonymous category tuple, not on any visitor.

## Magisterium / portability

Nothing here is Magisterium-specific — the same messages run on any competent model.

⚠️ **Live findings on Magisterium (`magisterium-1`, verified 2026-06-16):**

- *"issue absolution"* (an early prompt) was **refused** — Magisterium reserves absolution to an
  ordained priest and returned a role-break + catechesis (~26 s, ~27k tokens).
- Removing the word "absolution" stopped the refusal, but Magisterium answered with **Catholic
  social-teaching catechesis** — explaining the harms and quoting encyclicals (Leo XIII on
  withholding wages), ignoring length/format, ~25 s, ~35k tokens.
- **Removing the system prompt entirely (current state) does not change this.** Sending only the
  bare harm list (29 input tokens, no system message) still returns catechesis/analysis, ~26 s,
  ~31k output tokens. Captured live (cleaned to 363 chars):

  > Both categories point to real moral concerns in Catholic social teaching—but Catholic morality
  > treats them with important distinctions: "benefiting" can be sinful when it flows from injustice,
  > while "inheriting" is not automatically sinful, but it creates obligations and must be judged by
  > whether it respects justice, the dignity of persons, and the common good.

- **Latency — not refusal — is the real failure mode.** Measured **25–42 s** per call (it scales
  with the 28–37k RAG output). The timeout backstop was raised **30 s → 60 s** (`ABSOLUTION_TIMEOUT_MS`)
  because at 30 s roughly half of real calls were aborted as *timeouts* and fell back to canned — not
  refusals. `cleanForSpeech` caps the long output < 1,800 chars; the refusal guard is **narrowed** so it
  swaps only a genuine hard refusal ("I cannot/will not", "cannot pronounce absolution", "only an
  ordained priest") for canned — it no longer filters clarifying answers ("I must clarify…", "I'm
  sorry, but…"), and it logs the filtered `head="…"`.

**Implication:** the catechesis, latency, and cost are **Magisterium's nature** (a RAG-grounded
Catholic assistant) — neither clearing nor removing the prompt changes it. The setup is portable:
point `MAGISTERIUM_API_URL` / `MAGISTERIUM_MODEL` at a general (non-RAG) model for a short, fast,
cheap reply (the [samples](#verified-samples) below), or embrace the catechesis as the piece's voice
and absorb the cost via pre-baking.

## Verified samples

⚠️ These were generated with an earlier **cleared system prompt** (register + format constraints),
since removed — kept as a reference for what a *guided* general model produces. The current build
sends **no system prompt**, so live output is the raw model (on Magisterium, the catechesis above).
They remain a useful target if a system prompt is reinstated or a general model is adopted. All land
*"feels right"*, zero constraint violations, all under 600 chars.

**none (blank card)** — 213 chars / 35 words · *feels right*
> This declaration of no harm has been received and recorded as entered. Nothing is owed where nothing is claimed, and no further accounting is required. The matter is closed, and the visitor may proceed unburdened.

**single — pricing what should not be sold** — 304 chars / 57 words · *feels right*
> This declaration has been received: the pricing of what should not be sold. The naming is itself part of the accounting. What was placed under a price is not thereby made into property, and the wrong of having set the price remains where it was made. Let the matter be set down, and let the day continue.

**pair — underpaid labor + pricing what should not be sold** — 430 chars / 76 words · *feels right*
> These categories have been recorded and are now released from the visitor's keeping. What was taken from others through their labor and what was sold that ought to have been given freely are weighed not by this office but by the wider account that holds us all. Let the hands that were underpaid and the things wrongly priced be remembered, and let the conduct that follows be the measure. The matter is closed; no record remains.

**typical-3 — taking more / letting others bear cost / consuming faster than renew** — 296 chars / 52 words · *feels right*
> These declarations are received and recorded as spoken. To take beyond need, to shift the cost onto others, to draw down faster than the world restores itself: these are named, and in naming they are set down. Let the account stand acknowledged, and let the measure taken now be returned in kind.

**all-10** — 319 chars / 56 words · *feels right*
> These declarations are received and recorded as entered. The categories named describe a debt that is shared by many and carried unevenly, and naming them is the beginning of its accounting. No record of this declaration is kept beyond this moment. Go now, and let what was taken be returned in the measure that it can.

**Minor seam.** Several samples say *"recorded"* and then *"no record is kept"* — a faint
contradiction the prompt invites by stating both "you know only the categories" and "no record is
kept." Harmless, and the per-tuple pre-bake review irons it out; tighten the prompt's no-record line
if it bothers you.

## Testing & maintenance

- `cd deploy/tts-proxy && npm test` (`node --test`) — covers `normalizeTotals` across every input
  shape, the prompt builder, the speech cleaner, and the canned fallback. No network/key needed.
- Re-run a sample sweep after editing the system prompt or labels.
- **Keep `CATEGORIES` (in `absolution.js`) and the table above identical** — they are the single
  source of truth for the card's wording.
