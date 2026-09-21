# LinkedIn Slop Filter — Approach Document

*Last updated: September 2026*

---

## The Problem

LinkedIn's feed has become a content wasteland. AI-generated posts follow predictable templates: vague inspirational openers, engagement-bait closers, LLM vocabulary, one-sentence-per-line formatting, and zero concrete specifics. Scrolling through it is a tax on your attention.

No existing tool solves this well. The local ones (regex, heuristics) are too dumb. The cloud ones (GPT-4, Claude) are too expensive and too slow to run on every post forever. The on-device model (Gemini Nano) is free but requires Chrome Canary with experimental flags. None of them have calibrated confidence — they either hide a post or they don't, with no honest signal about how sure they are.

Our approach: a three-layer hybrid pipeline powered by Jev (TypeSafe AI's classification model), designed to be accurate, cheap enough to run indefinitely, and honest about uncertainty.

---

## OSS Landscape — What We Studied

We surveyed 16+ open-source repos. Full breakdown:

| Stars | Repo | Approach |
|-------|------|----------|
| 106⭐ | Pankajtanwarbanna/cringe-guard | Groq API, blur/vanish modes, promoted-tag detection, mute words |
| 3⭐ | OdinMB/linkedin-detox | Pattern matching + optional embeddings; replaces slop with snarky roast banners. On Chrome Web Store |
| 2⭐ | pkarstaedt/linkedin-ai-filter | Multi-provider: OpenAI / Claude / Gemini / local LLM; test mode |
| 2⭐ | gagangulyani/deslopmyfeed | Fully local heuristics, 7 detection categories, user feedback adjusts weights |
| 1⭐ | Pragith/linkedin-slop-detector | Privacy-first stylistic pattern detection |
| 1⭐ | swisnieski85/slop-sniffer | Mask-on-detect approach |
| 1⭐ | wazeerc/notanotheraipost | Lightweight local filter |
| 1⭐ | Siriusbar/SlopedIn | Local in-browser detection |
| 1⭐ | JesseVent/slopblock-plus | Heuristic blocker |
| 1⭐ | callmety/openslop | Single-API-call approach |
| 0⭐ | kimjune01/linkedin-slop-filter | Chrome's on-device Gemini Nano; best UX in the field |
| 0⭐ | Alibi155/SlopFilter | Local logistic regression that learns from user feedback; best engineering |

**What no one has done:** a purpose-built calibrated classification model (not a chat LLM) with a local pre-filter to avoid API calls on obvious cases. That's our lane.

---

## Key Insights From the Field

### 1. The deciding signal is concrete specificity (kimjune01)

> "Does the post contain ANY concrete specific detail? Real numbers, real names, technical specifics, an actual problem being solved. If YES → score low even if the style is punchy. If it's all generic advice that could apply to anyone → score high."

This is the single best heuristic in the entire field. Every other signal — em-dashes, rocket emoji, sentence-per-line formatting — is a surface pattern that can be gamed. The presence of concrete specifics is harder to fake and is what actually separates a real post from slop.

### 2. Detect patterns, not provenance (deslopmyfeed)

> "DeSlopMyFeed is not an AI authorship detector. It detects patterns, not provenance."

There is deliberately no "93.72% AI generated" number anywhere. We follow this principle. Jev returns a calibrated 0–1 confidence — we show it honestly (e.g. `slop 76%`) but never claim we know who wrote it. A human can write something that looks like AI, and vice versa.

### 3. Show evidence, not just verdicts (Alibi155/SlopFilter)

Every hidden post should show exactly what triggered it. The user should be able to read `slop 89% · "let that sink in" · engagement bait` and understand the decision — and disagree if they want. Black-box hiding breeds distrust.

### 4. The UX bar matters more than the algorithm (kimjune01)

The collapse-to-bar pattern — `🧹 Slop 89% · engagement bait · Show anyway` — is far better than opacity fade. The post isn't lost. The user feels in control. A floating pill counter shows the filter is working. These UX choices affect whether someone keeps using the extension.

### 5. Pre-screen the obvious slop locally (Alibi155 + deslopmyfeed)

~40% of slop is caught by simple phrase matching — "let that sink in", "Agree?", "harness the power", "in today's fast-paced world". Running that check locally (0ms, $0) before hitting any API cuts costs significantly and makes the extension viable forever.

### 6. Promoted posts should be auto-collapsed, separate from slop scoring (cringe-guard)

LinkedIn's "Promoted" tag is a structural signal, not a content signal. Auto-collapse these by DOM detection without calling any model.

---

## Our Architecture

### The Three-Layer Pipeline

```
New post detected
        │
        ▼
┌─────────────────────────────────────────────────┐
│ LAYER 1 — Local Pre-filter (0ms, $0)            │
│                                                 │
│  • MIN_CHARS = 40 guard (skip image captions)  │
│  • Promoted tag detection (DOM, structural)     │
│  • Phrase catalog: OPENERS / BAIT / LLM_VOCAB  │
│  • Styled unicode detection (fake-bold AI tell) │
│                                                 │
│  Obvious slop → COLLAPSE (no API call needed)  │
│  Ambiguous → pass to Layer 2                   │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ LAYER 2 — Jev Classification (70–150ms, ~$0)    │
│                                                 │
│  POST https://api.typesafe.ai/v1/systemone      │
│  model: jev-latest                              │
│                                                 │
│  Questions (evaluated in parallel):             │
│  • is_slop (noul): "generic AI filler with no  │
│    concrete specific detail"                    │
│  • is_ad (noul): "promotional/sponsored content"│
│                                                 │
│  Returns: noul score 0–1, calibrated           │
│  Above threshold → COLLAPSE with score+evidence │
│  Below threshold → show normally               │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ LAYER 3 — User Feedback (local, continuous)     │
│                                                 │
│  "Useful — show more like this"                 │
│  "Hide more like this"                          │
│                                                 │
│  Stores per-user threshold adjustments locally  │
│  Never stores post text, author, or URLs        │
└─────────────────────────────────────────────────┘
```

### Why Jev, not a chat LLM

| | GPT-4o / Claude | Gemini Nano (on-device) | **Jev** |
|---|---|---|---|
| Latency | 3–30s | 100–500ms | **70–150ms** |
| Cost / 1M posts | ~$14,000 | $0 | **~$42** |
| Accuracy | High | Moderate | **High** |
| Calibrated confidence | No (overconfident) | No | **Yes** |
| Requires setup | API key | Chrome Canary flags | **API key** |
| Hallucination risk | Yes | Yes | **No** |
| Output type | Text to parse | Text to parse | **Typed float** |

Jev is purpose-built for classification. It returns a typed 0–1 float with calibrated probability. It cannot hallucinate. It's 200x cheaper than Claude and 40x faster than GPT-4.

---

## Detection Signal Catalog

Drawn from Alibi155's `rules.ts` (19,000+ lines of curated patterns) and kimjune01's prompt research.

### Structural signals (layer 1, local)
- **Promoted tag**: `div[data-promoted]` or text matching `"Promoted"` in post header
- **Styled unicode**: fake-bold characters (ℬold Unicode) — almost always AI-generated
- **One-sentence-per-line**: ≥5 lines with ≤ 12 words per line
- **Emoji density**: ≥3 distinct emojis in a post under 200 words
- **Excessive hashtags**: ≥5 hashtags

### Phrase signals (layer 1, local)

**Openers** (template indicators):
> "here's the thing", "unpopular opinion", "let that sink in", "read that again", "hot take", "let me be blunt", "stop scrolling", "buckle up", "plot twist", "nobody talks about this", "this changes everything"

**Engagement bait** (closer indicators):
> "Agree?", "Thoughts?", "tag someone who", "follow me for more", "save this post", "comment below", "drop a 🙌", "repost if", "who else"

**LLM vocabulary** (semantic indicators):
> "delve", "tapestry", "testament to", "navigate the landscape", "game-changer", "in today's fast-paced", "ever-evolving", "unlock the power", "harness the power", "paradigm shift", "cutting-edge", "seamless integration", "robust solution", "elevate your", "moving forward", "furthermore", "moreover", "it's worth noting", "key takeaways", "in conclusion"

**Humblebrag/announce openers**:
> "humbled to announce", "thrilled to share", "excited to announce", "had the pleasure of", "so proud to", "beyond grateful"

### Semantic signals (layer 2, Jev)
- No concrete specific detail (the deciding factor per kimjune01)
- Generic advice applicable to anyone
- Pseudo-profound life lesson that is too vague to test

---

## UX Decisions

### Collapse-to-bar, not opacity fade

**Don't:** fade to 10% opacity and leave a ghost on screen.

**Do:** collapse the post to a slim bar:
```
🧹  slop 89%  ·  "let that sink in"  ·  engagement bait  ·  Show anyway
```

The post is not gone. The user knows what was caught and why. They can read it with one click. This is from kimjune01 and it's the best UX in the field.

### Floating pill counter

Bottom-right corner: `Slop filter: 7 hidden`. Click to toggle the filter off/on. Users need to see the filter is working.

### Debug / test mode (from pkarstaedt)

When enabled: show Jev score on every post as a label, but hide nothing. Lets users calibrate their threshold before committing. Essential for trust.

### Evidence in the bar (from Alibi155)

Always show what triggered the collapse. One specific matched phrase or signal, not just a score. `slop 89% · "let that sink in"` is a verdict the user can agree or disagree with. `slop 89%` is a black box.

### Feedback buttons (from deslopmyfeed + Alibi155)

Every collapsed bar exposes: `Useful — show more like this` and `Too aggressive — don't hide this`. These adjust local weights. No post content is stored, only the feedback signal.

### Mode options (from cringe-guard)

- **Fade** — gentle, post stays visible but dimmed (10% opacity)
- **Collapse** ← default — slim bar with evidence, one-click reveal
- **Hide** — complete removal from visual flow

---

## DOM Selectors (Defensive)

LinkedIn changes class names frequently. We use multiple fallbacks, ordered by stability:

**Post containers** (most → least stable):
```js
'span[data-testid="expandable-text-box"]'   // most stable (testid changes rarely)
'.fie-impression-container'                   // kimjune01 addition
'div.feed-shared-update-v2'                  // widely used, changes occasionally
'article.feed-shared-update-v2'
'div[data-urn*="activity"]'
```

**Text content** (most → least stable):
```js
'.update-components-update-v2__commentary'   // kimjune01 addition
'.update-components-text .break-words'
'.feed-shared-text .break-words'
'.feed-shared-text__text-view'
'.feed-shared-inline-show-more-text'
'.update-components-text'
'.feed-shared-text'
```

---

## Implementation Map

```
linkedin-slop-filter/
├── manifest.json          Chrome MV3
├── background.js          Jev API calls (service worker, avoids CORS)
├── content.js             MutationObserver + DOM pipeline + UX
├── prefilter.js           Layer 1: phrase catalog + structural checks
├── popup.html/js          API key, threshold, mode, debug toggle
└── APPROACH.md            This document
```

### background.js responsibilities
- Read `apiKey`, `threshold`, `mode` from storage
- Receive `classify` message from content.js with batched post texts
- Fire parallel Jev calls (one per post, max 8 per batch)
- Return `{ results: [{id, noul, slop, ad, evidence}], threshold }`

### content.js responsibilities
- MutationObserver on `document.body`
- Layer 1 pre-filter before queueing
- 700ms debounce, batches of 8
- Result cache (post text → verdict) — avoids re-classifying on scroll-back
- Apply UX (collapse bar, pill counter, debug labels)
- Feedback signal storage

### prefilter.js responsibilities
- `prefilter(text)` → `{ flag: bool, reason: string | null }`
- Promoted tag check (DOM)
- Structural checks: styled unicode, one-sentence-per-line, emoji density, hashtag density
- Phrase catalog: OPENERS, BAIT, LLM_VOCAB, HUMBLEBRAG — returns first matched phrase as evidence
- Sub-40-char guard

---

## What We Don't Claim

This extension detects slop patterns. It does not:
- Know who wrote a post
- Know which model was used
- Prove a post is AI-generated
- Prove a post is human-written

A confident professional who writes short punchy posts with engagement CTAs will get flagged. An LLM prompted with specific anecdotes and real numbers won't. This is fine — the filter is for your feed quality, not for policing authorship.

There is no "93.72% AI generated" number in the UI. Jev gives us a calibrated 0–1 score; we surface it honestly and let the user decide.

---

## Open Questions

1. **Threshold default**: 0.75 is our starting point but needs real-feed calibration. Debug mode is specifically for this.
2. **Selector drift**: LinkedIn will change class names. The `data-testid` anchor is our most stable bet; monitoring for breakage is ongoing maintenance.
3. **Language support**: The phrase catalog is English-only for now. Alibi155 has EN+DE. Worth expanding as usage grows.
4. **Jev early access**: API is in early access as of Sep 2026. If access is constrained, fallback to a local heuristic-only mode (layer 1 only).

---

## Sources

| Repo | What we took |
|------|-------------|
| kimjune01/linkedin-slop-filter | Concrete-specificity test; collapse-to-bar UX; floating pill; result cache; MIN_CHARS guard; `.fie-impression-container` selector |
| Alibi155/SlopFilter | Phrase catalog (OPENERS/BAIT/LLM_VOCAB); evidence-in-verdict UX; feedback signal model; styled unicode detection; 0.3ms pre-filter approach |
| pkarstaedt/linkedin-ai-filter | `span[data-testid="expandable-text-box"]` selector; debug/test mode |
| gagangulyani/deslopmyfeed | "Patterns not provenance" framing; feedback buttons; no fake-precision percentages |
| Pankajtanwarbanna/cringe-guard | Promoted-tag auto-collapse; blur/vanish/collapse mode options |
| OdinMB/linkedin-detox | Evidence that Chrome Web Store distribution is viable for this category |
