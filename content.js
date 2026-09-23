// LinkedIn Slop Filter — content script
// Watches the feed, extracts post text, asks classifier, fades slop.

const CHECKED_ATTR = "data-slop-checked";
const FADE_CLASS   = "jev-slop-faded";

console.info(
  "%c[LinkedIn Slop Filter] ACTIVE %cWatching feed on " + window.location.href,
  "background: #0a66c2; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;",
  "color: #0a66c2; font-weight: bold; margin-left: 8px;"
);

// --- Styles ----------------------------------------------------------------

const style = document.createElement("style");
style.textContent = `
  #slop-filter-indicator {
    position: fixed !important;
    bottom: 24px !important;
    right: 24px !important;
    z-index: 2147483647 !important;
    background: #0a66c2 !important;
    color: white !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    padding: 7px 16px !important;
    border-radius: 20px !important;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3) !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    transition: all 0.3s ease !important;
    cursor: default !important;
    user-select: none !important;
    pointer-events: auto !important;
  }
  @keyframes slop-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .slop-spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: slop-spin 0.8s linear infinite;
    vertical-align: middle;
    margin-right: 5px;
  }
  .slop-box-scanning {
    position: relative !important;
    outline: 3px dashed #0a66c2 !important;
    outline-offset: -2px !important;
    border-radius: 8px !important;
    transition: outline 0.2s ease !important;
  }
  .slop-box-slop {
    position: relative !important;
    outline: 3px dashed #d93025 !important;
    outline-offset: -2px !important;
    border-radius: 8px !important;
  }
  .jev-slop-faded {
    opacity: 0.18 !important;
    filter: grayscale(60%) !important;
    transition: opacity 0.25s ease, filter 0.25s ease !important;
  }
  .jev-slop-faded:hover {
    opacity: 1 !important;
    filter: none !important;
  }
  .jev-badge {
    position: absolute !important;
    top: 12px !important;
    right: 54px !important;
    font-size: 11px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    padding: 3px 10px !important;
    border-radius: 12px !important;
    pointer-events: none !important;
    z-index: 9999 !important;
    letter-spacing: 0.02em !important;
    font-weight: 600 !important;
    box-shadow: 0 1px 4px rgba(0,0,0,0.2) !important;
    display: inline-flex !important;
    align-items: center !important;
  }
  .jev-badge-slop {
    background: rgba(217, 48, 37, 0.95) !important;
    color: #fff !important;
  }
  .jev-badge-clean {
    background: rgba(39, 174, 96, 0.9) !important;
    color: #fff !important;
  }
  .jev-badge-pending {
    background: rgba(10, 102, 194, 0.9) !important;
    color: #fff !important;
  }
`;
document.head.appendChild(style);

// --- Indicator widget ------------------------------------------------------

let scannedCount = 0;
let fadedCount = 0;
let indicatorEl = null;

function updateIndicator(msg, status = "active") {
  if (!indicatorEl) {
    indicatorEl = document.createElement("div");
    indicatorEl.id = "slop-filter-indicator";
    document.body.appendChild(indicatorEl);
  }
  const html = `🛡️ ${msg}`;
  if (indicatorEl.innerHTML === html) return;
  indicatorEl.innerHTML = html;
  if (status === "error") {
    indicatorEl.style.background = "#d93025";
  } else if (status === "disabled") {
    indicatorEl.style.background = "#5f6368";
  } else {
    indicatorEl.style.background = "#0a66c2";
  }
}

updateIndicator("Slop Filter: Active");

// --- Settings --------------------------------------------------------------

let ENABLED   = true;
let THRESHOLD = 0.75;

chrome.storage.sync.get({ enabled: true, threshold: 0.75 }, s => {
  ENABLED   = s.enabled;
  THRESHOLD = s.threshold;
  if (!ENABLED) updateIndicator("Slop Filter Disabled", "disabled");
  console.log(`[LinkedIn Slop Filter] Settings loaded: enabled=${ENABLED}, threshold=${THRESHOLD}`);
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.enabled) {
    ENABLED = changes.enabled.newValue;
    console.log(`[LinkedIn Slop Filter] Enabled state updated: ${ENABLED}`);
  }
  if (changes.threshold) {
    THRESHOLD = changes.threshold.newValue;
    console.log(`[LinkedIn Slop Filter] Threshold updated: ${THRESHOLD}`);
  }
});

// --- DOM helpers -----------------------------------------------------------

function findPosts(root = document) {
  if (document.hidden) return [];
  const posts = new Set();

  // 1. Primary: Direct children of feed container via action buttons (100% reliable)
  try {
    const actionButtons = root.querySelectorAll(
      "button[aria-label*='Like' i], button[aria-label*='React' i], button[aria-label*='Comment' i], button[aria-label*='Repost' i], " +
      "[role='button'][aria-label*='Like' i], [role='button'][aria-label*='React' i]"
    );
    for (const btn of actionButtons) {
      // Direct child of feed content is always the exact post card
      const directFeedItem = btn.closest(".scaffold-finite-scroll__content > *");
      if (directFeedItem && !directFeedItem.classList.contains("scaffold-finite-scroll__loading-indicator")) {
        posts.add(directFeedItem);
        continue;
      }

      // Fallback walking up to find nearest card boundary
      let p = btn.parentElement;
      while (p && p !== document.body && p.tagName !== "MAIN") {
        if (
          p.classList.contains("feed-shared-update-v2") ||
          p.getAttribute("role") === "listitem" ||
          p.getAttribute("data-urn") ||
          p.getAttribute("data-id")
        ) {
          if (!p.classList.contains("scaffold-finite-scroll") && !p.classList.contains("scaffold-finite-scroll__content")) {
            posts.add(p);
          }
          break;
        }
        if (
          p.offsetHeight >= 120 &&
          p.offsetHeight <= 3000 &&
          p.offsetWidth >= 250 &&
          p.querySelector("button[aria-label*='Follow' i], [data-view-name*='actor'], .feed-shared-actor, .update-components-actor")
        ) {
          if (!p.classList.contains("scaffold-finite-scroll") && !p.classList.contains("scaffold-finite-scroll__content")) {
            posts.add(p);
          }
          break;
        }
        p = p.parentElement;
      }
    }
  } catch (e) {}

  // 2. Direct feed item inspection inside scaffold-finite-scroll__content
  try {
    const feedContent = root.querySelector(".scaffold-finite-scroll__content");
    if (feedContent) {
      for (const child of feedContent.children) {
        if (
          child.offsetHeight >= 120 &&
          !child.classList.contains("scaffold-finite-scroll__loading-indicator") &&
          child.querySelector("button[aria-label*='Like' i], button[aria-label*='React' i], .feed-shared-social-action-bar, .social-details-social-actions")
        ) {
          posts.add(child);
        }
      }
    }
  } catch (e) {}

  // 3. Fallback for demo page and generic feed cards
  try {
    root.querySelectorAll("article.feed-shared-update-v2, .feed-shared-update-v2").forEach(el => {
      if (el.offsetHeight >= 120 && !el.classList.contains("scaffold-finite-scroll__content")) {
        posts.add(el);
      }
    });
  } catch (e) {}

  // Deduplication: Keep outermost post card, discard any inner nested items!
  const rawList = Array.from(posts);
  const filtered = rawList.filter(el => {
    for (const other of rawList) {
      if (other !== el && other.contains(el)) {
        return false; // el is nested inside other, drop el and keep the outer card!
      }
    }
    return true;
  });

  // Filter out LinkedIn UI widgets (e.g. "Start a post", recommendation carousels, news modules)
  return filtered.filter(el => {
    // 1. Exclude "Start a post" box
    if (
      el.querySelector("button.share-box-feed-entry__trigger, [data-view-name*='feed-creation'], .share-box-feed-entry") ||
      el.classList.contains("share-box-feed-entry") ||
      el.classList.contains("share-box-feed-entry__wrapper") ||
      (el.textContent?.includes("Start a post") && !el.querySelector("button[aria-label*='Like' i], button[aria-label*='React' i]"))
    ) {
      return false;
    }

    // 2. Exclude recommendation carousels / side modules / jobs / puzzles
    if (
      el.querySelector("[data-view-name*='job-card'], .feed-shared-news-module") ||
      el.classList.contains("feed-shared-news-module") ||
      el.textContent?.includes("Jobs recommended for you") ||
      el.textContent?.includes("Add to your feed") ||
      el.textContent?.includes("Today’s puzzles")
    ) {
      return false;
    }

    // 3. Legitimate post verification: Must have social interaction buttons (Like, React, Comment, Repost)
    const hasInteraction = el.querySelector(
      "button[aria-label*='Like' i], button[aria-label*='React' i], button[aria-label*='Comment' i], .feed-shared-social-action-bar, .social-details-social-actions"
    );
    if (!hasInteraction && !el.classList.contains("feed-shared-update-v2") && el.tagName !== "ARTICLE") {
      return false;
    }

    return true;
  });
}

function extractText(post) {
  // Safeguard: Discard if element is UI creation box
  const rawPreview = post.textContent || "";
  if (rawPreview.includes("Start a post") && !post.querySelector("button[aria-label*='Like' i], button[aria-label*='React' i]")) {
    return null;
  }

  // 1. Try known specific text selectors for post body
  const selectors = [
    ".feed-shared-update-v2__description",
    ".feed-shared-inline-show-more-text",
    ".update-components-text",
    ".feed-shared-text",
    "[data-ad-preview='message']",
    ".break-words"
  ];

  for (const sel of selectors) {
    const el = post.querySelector(sel);
    if (el) {
      const t = el.textContent?.trim();
      if (t && t.length > 15) return t;
    }
  }

  // 2. Search readable text elements inside the post (skipping author headers, buttons, social counts)
  const candidates = post.querySelectorAll(".update-components-text, .feed-shared-text, .break-words, p, span, div");
  let longest = "";
  for (const el of candidates) {
    if (el.closest("header, button, nav, .feed-shared-actor, .update-components-actor, .social-details-social-counts, .feed-shared-social-actions, .comments-comment-item")) {
      continue;
    }
    if (el.children.length > 4) continue;
    const t = el.textContent?.trim() || "";
    if (t.length > longest.length) {
      longest = t;
    }
  }
  if (longest.length > 15) return longest;

  // 3. Fallback: Take all text from the card
  const fullText = post.textContent?.trim() || "";
  if (fullText.length > 25) {
    return fullText.slice(0, 1000);
  }

  return null;
}

function postId(post) {
  return (
    post.getAttribute("data-urn") ||
    post.getAttribute("data-activity-urn") ||
    post.getAttribute("data-id") ||
    post.getAttribute("id") ||
    null
  );
}

function setBadge(post, id, text, cls) {
  removeBadge(post, id);
  const b = document.createElement("span");
  b.className = `jev-badge ${cls}`;
  b.dataset.badgeId = id;
  b.innerHTML = text;
  post.appendChild(b);
}

function removeBadge(post, id) {
  post.querySelectorAll(`[data-badge-id="${id}"]`).forEach(el => el.remove());
}

// --- Queue & sequential batching -------------------------------------------

const queue = [];
let flushTimer = null;
let isFlushing = false;

function enqueue(post) {
  if (!ENABLED) return;
  if (post.hasAttribute(CHECKED_ATTR)) return;

  const text = extractText(post);
  if (!text) {
    return;
  }

  const id = postId(post) || `gen-${Math.random().toString(36).slice(2)}`;
  post.setAttribute(CHECKED_ATTR, id);

  // 1. Draw square around the fetched box
  post.classList.add("slop-box-scanning");

  // 2. Add progress icon on top right: classifying...
  setBadge(post, id, '<span class="slop-spinner"></span> classifying…', "jev-badge-pending");

  scannedCount++;
  console.log(`[LinkedIn Slop Filter] Enqueued post ${id}: "${text.slice(0, 50).replace(/\n/g, ' ')}..."`);
  queue.push({ id, text, el: post });
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer || isFlushing) return;
  flushTimer = setTimeout(flush, 300);
}

function flush() {
  flushTimer = null;
  if (isFlushing || !queue.length) return;
  isFlushing = true;

  // Process in small batches of 2 sequentially to avoid CPU/connection contention
  const batch = queue.splice(0, 2);
  console.log(`[LinkedIn Slop Filter] Classifying batch of ${batch.length} posts...`);

  chrome.runtime.sendMessage(
    { type: "classify", posts: batch.map(p => ({ id: p.id, text: p.text })) },
    resp => {
      isFlushing = false;

      if (chrome.runtime.lastError) {
        console.error("[LinkedIn Slop Filter] Background message error:", chrome.runtime.lastError.message);
        cleanup(batch);
        if (queue.length) scheduleFlush();
        return;
      }
      if (!resp) {
        console.warn("[LinkedIn Slop Filter] Empty response from background worker");
        cleanup(batch);
        if (queue.length) scheduleFlush();
        return;
      }
      if (resp.error) {
        console.error("[LinkedIn Slop Filter] Backend returned error:", resp.error);
        updateIndicator("Slop Filter: Backend Error", "error");
        cleanup(batch);
        if (queue.length) scheduleFlush();
        return;
      }

      const threshold = resp.threshold ?? THRESHOLD;
      console.log(`[LinkedIn Slop Filter] Received classification results for ${resp.results?.length || 0} posts (threshold=${threshold})`);

      for (const result of (resp.results ?? [])) {
        const item = batch.find(p => p.id === result.id);
        if (!item || !item.el || !item.el.isConnected) continue;

        item.el.classList.remove("slop-box-scanning");
        removeBadge(item.el, item.id);

        if (result.error) {
          console.warn(`[LinkedIn Slop Filter] Post ${result.id} failed classification:`, result.error);
          item.el.removeAttribute(CHECKED_ATTR); // allow retry on transient error
          continue;
        }

        const score = result.noul ?? 0;
        const pct = Math.round(score * 100);
        console.log(`[LinkedIn Slop Filter] Post ${result.id} -> slop=${result.slop}, ad=${result.ad}, max=${score} (threshold=${threshold})`);

        // Transition progress icon to %slop and update square outline
        if (score >= threshold) {
          item.el.classList.add("slop-box-slop");
          item.el.classList.add(FADE_CLASS);
          const label = result.ad > result.slop ? `📢 ${pct}% ad` : `⚠️ ${pct}% slop`;
          setBadge(item.el, item.id, label, "jev-badge-slop");
          fadedCount++;
          console.log(`[LinkedIn Slop Filter] Faded post ${result.id} with label "${label}"`);
        } else {
          // Clean post: Remove scanning box outline completely!
          // Show subtle clean checkmark badge in top-right:
          setBadge(item.el, item.id, `✓ ${pct}% slop`, "jev-badge-clean");
        }
      }

      updateIndicator(`Slop Filter: ${scannedCount} scanned · ${fadedCount} faded`);

      // If more posts are queued, continue sequentially
      if (queue.length) {
        scheduleFlush();
      }
    }
  );
}

function cleanup(batch) {
  batch.forEach(p => {
    if (p.el && p.el.isConnected) {
      removeBadge(p.el, p.id);
      p.el.classList.remove("slop-box-scanning");
    }
  });
}

// --- Automatic Infinite Scroll Continuity -----------------------------------

function checkAndTriggerInfiniteScroll() {
  try {
    const loadBtn = document.querySelector(
      ".scaffold-finite-scroll__load-button, button[data-view-name*='load-more'], button[data-view-name*='finite-scroll']"
    );
    if (loadBtn && loadBtn.offsetParent !== null) {
      loadBtn.click();
    }
  } catch (e) {}
}

// --- High-Performance Scrolling & Scanning ---------------------------------

function scanDOM() {
  const posts = findPosts();
  if (posts.length) {
    posts.forEach(enqueue);
  }
  updateIndicator(`Slop Filter: ${scannedCount} scanned · ${fadedCount} faded`);
  checkAndTriggerInfiniteScroll();
}

// Initial scan
scanDOM();

// Smooth periodic scan every 1.5 seconds so newly rendered posts are picked up
setInterval(scanDOM, 1500);

// Passive, debounced scroll listener:
let scrollDebounce = null;
window.addEventListener(
  "scroll",
  () => {
    if (scrollDebounce) clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(() => {
      scrollDebounce = null;
      scanDOM();
    }, 250);
  },
  { passive: true }
);
