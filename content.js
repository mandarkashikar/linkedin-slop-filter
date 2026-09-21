// LinkedIn Slop Filter — content script
// Watches the feed, extracts post text, asks Jev to classify, fades slop.

const CHECKED_ATTR = "data-slop-checked";
const FADE_CLASS   = "jev-slop-faded";

// --- Styles ----------------------------------------------------------------

const style = document.createElement("style");
style.textContent = `
  .jev-slop-faded {
    opacity: 0.1;
    filter: grayscale(50%);
    transition: opacity 0.4s ease, filter 0.4s ease;
  }
  .jev-slop-faded:hover {
    opacity: 1 !important;
    filter: none !important;
  }
  .jev-badge {
    position: absolute;
    top: 10px;
    right: 12px;
    font-size: 10px;
    font-family: monospace;
    padding: 2px 7px;
    border-radius: 10px;
    pointer-events: none;
    z-index: 99;
    letter-spacing: 0.02em;
  }
  .jev-badge-slop {
    background: rgba(180,40,40,0.75);
    color: #ffd;
  }
  .jev-badge-pending {
    background: rgba(0,0,0,0.25);
    color: #aaa;
  }
`;
document.head.appendChild(style);

// --- Settings --------------------------------------------------------------

let ENABLED   = true;
let THRESHOLD = 0.75;

chrome.storage.sync.get({ enabled: true, threshold: 0.75 }, s => {
  ENABLED   = s.enabled;
  THRESHOLD = s.threshold;
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.enabled)   ENABLED   = changes.enabled.newValue;
  if (changes.threshold) THRESHOLD = changes.threshold.newValue;
});

// --- DOM helpers -----------------------------------------------------------

// LinkedIn changes class names frequently. Use multiple fallbacks.
const POST_SELECTORS = [
  "div.feed-shared-update-v2",
  "article.feed-shared-update-v2",
  "div[data-urn*='activity']",
];

const TEXT_SELECTORS = [
  ".feed-shared-text .break-words",
  ".update-components-text .break-words",
  ".feed-shared-text__text-view",
  ".feed-shared-inline-show-more-text",
  ".update-components-text",
  ".feed-shared-text",
];

function findPosts(root = document) {
  for (const sel of POST_SELECTORS) {
    const els = root.querySelectorAll(sel);
    if (els.length) return Array.from(els);
  }
  return [];
}

function extractText(post) {
  for (const sel of TEXT_SELECTORS) {
    const el = post.querySelector(sel);
    if (el) {
      const t = el.innerText?.trim();
      if (t && t.length > 15) return t;
    }
  }
  return null;
}

function postId(post) {
  return (
    post.getAttribute("data-urn") ||
    post.getAttribute("data-id") ||
    post.getAttribute("id") ||
    null
  );
}

function ensureRelative(el) {
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
}

function setBadge(post, id, text, cls) {
  removeBadge(post, id);
  const b = document.createElement("span");
  b.className = `jev-badge ${cls}`;
  b.dataset.badgeId = id;
  b.textContent = text;
  post.appendChild(b);
}

function removeBadge(post, id) {
  post.querySelector(`[data-badge-id="${id}"]`)?.remove();
}

// --- Queue & batching ------------------------------------------------------

const queue = [];
let flushTimer = null;

function enqueue(post) {
  if (!ENABLED) return;
  if (post.hasAttribute(CHECKED_ATTR)) return;
  const text = extractText(post);
  if (!text) return;

  const id = postId(post) || `gen-${Math.random().toString(36).slice(2)}`;
  post.setAttribute(CHECKED_ATTR, id);
  ensureRelative(post);
  setBadge(post, id, "jev…", "jev-badge-pending");

  queue.push({ id, text, el: post });
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 700);
}

function flush() {
  flushTimer = null;
  if (!queue.length) return;

  const batch = queue.splice(0, 8);

  chrome.runtime.sendMessage(
    { type: "classify", posts: batch.map(p => ({ id: p.id, text: p.text })) },
    resp => {
      if (!resp) return cleanup(batch);
      if (resp.error === "no_api_key") return cleanup(batch);

      const threshold = resp.threshold ?? THRESHOLD;

      for (const result of (resp.results ?? [])) {
        const item = batch.find(p => p.id === result.id);
        if (!item) continue;

        removeBadge(item.el, item.id);

        if (result.error) continue; // silently skip failed classifications

        const score = result.noul ?? 0;
        if (score >= threshold) {
          item.el.classList.add(FADE_CLASS);
          const pct = Math.round(score * 100);
          const label = result.ad > result.slop ? `ad ${pct}%` : `slop ${pct}%`;
          setBadge(item.el, item.id, label, "jev-badge-slop");
        }
      }
    }
  );

  if (queue.length) scheduleFlush();
}

function cleanup(batch) {
  batch.forEach(p => removeBadge(p.el, p.id));
}

// --- MutationObserver ------------------------------------------------------

findPosts().forEach(enqueue);

const observer = new MutationObserver(mutations => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (!(node instanceof Element)) continue;
      for (const sel of POST_SELECTORS) {
        if (node.matches?.(sel)) enqueue(node);
        node.querySelectorAll(sel).forEach(enqueue);
      }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
