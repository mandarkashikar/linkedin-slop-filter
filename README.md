# LinkedIn Slop Filter

A Chrome extension prototype that classifies LinkedIn feed posts with TypeSafe AI's Jev model and fades likely AI slop or advertising.

## Current behavior

- Watches the LinkedIn feed as posts load.
- Batches new post text for classification.
- Asks Jev whether each post is low-value AI filler or an advertisement.
- Fades posts above a configurable confidence threshold.
- Keeps the API key in Chrome's synced extension storage; no key is committed to this repository.

## Load locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open the extension popup, enter a Jev API key, and set the threshold.
5. Visit LinkedIn and scroll the feed.

## Status

This is a safe prototype: it moves no money, needs no backend, and contains no committed credentials. The planned hybrid architecture and research behind it are documented in [APPROACH.md](APPROACH.md).

