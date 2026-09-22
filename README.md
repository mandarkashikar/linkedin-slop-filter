# LinkedIn Slop Filter

A Chrome extension that watches your LinkedIn feed and fades posts that are likely AI-generated filler, thought-leader platitudes, or ads.

## How it works

Posts are batched as they load, sent to a classifier, and scored 0–1 for *slop* and *ad*. Posts above your threshold are faded to 10% opacity. Hover any faded post to reveal it.

Two classifier backends are supported:

| Backend | What it needs | Privacy |
|---|---|---|
| **Local Ollama** (default) | Ollama running locally with any model | Fully local, nothing leaves your machine |
| **Jev (TypeSafe AI)** | A TypeSafe API key | Cloud API call per post |

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder.
4. The extension icon appears in your toolbar.

## Use with Ollama (local, private)

1. [Install Ollama](https://ollama.com) if you haven't already.
2. Pull a model: `ollama pull gemma4` (or `llama3.2`, `mistral`, etc.)
3. Allow Chrome extensions to call Ollama:

   ```bash
   launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
   ```

4. Quit and reopen the Ollama macOS app so it picks up the setting.
5. Open the extension popup, set Backend to **Local Ollama**, enter the model name, save.
6. Visit LinkedIn and scroll the feed — posts start getting scored immediately.

> Ollama must be running on `localhost:11434`. The extension calls it directly from the service worker.
> Ollama blocks browser-extension origins by default; `OLLAMA_ORIGINS` is required for local Chrome-extension access.

## Use with Jev (TypeSafe AI)

1. Get an API key at [console.typesafe.ai/keys](https://console.typesafe.ai/keys).
2. Open the extension popup, set Backend to **Jev — TypeSafe AI**, paste your key, save.

## Run the local demo

With Ollama running and `gemma4` installed:

```bash
python3 -m http.server 8765 --directory demo
```

Then open <http://127.0.0.1:8765/>. The extension classifies four sample posts locally so you can verify that generic filler and promotional content fade while specific posts remain visible.

## Settings

- **Backend** — Ollama (local) or Jev (cloud).
- **Ollama model** — any model you have installed (`ollama list` to check).
- **Slop threshold** — 40%–95%. Posts scoring above this are faded. Higher = stricter.
- **On/Off toggle** — disable filtering without uninstalling.

## Status

Prototype. LinkedIn changes its DOM structure often — if posts stop being detected, check the selectors in `content.js`.

Research and architecture notes: [APPROACH.md](APPROACH.md)
