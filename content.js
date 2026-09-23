// Feed Slop Filter — content script
// Watches the feed, extracts post text, asks classifier, fades slop.
// Supports: LinkedIn, Substack

const CHECKED_ATTR = "data-slop-checked";
const FADE_CLASS   = "jev-slop-faded";

const CURRENT_SITE = (() => {
  const h = window.location.hostname;
  if (h.includes("linkedin.com")) return "linkedin";
  if (h.includes("substack.com")) return "substack";
  return "generic";
})();

console.info(
  "%c[Feed Slop Filter] ACTIVE %cWatching " + CURRENT_SITE + " on " + window.location.href,
  "background: #0a66c2; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;",
  "color: #0a66c2; font-weight: bold; margin-left: 8px;"
);

// --- Styles ----------------------------------------------------------------

const style = document.createElement("style");
style.textContent = `
  #slop-filter-indicator {
    position: fixed !important;
    bottom: 72px;
    right: 24px;
    z-index: 2147483647 !important;
    background: #0a66c2 !important;
    color: white !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    padding: 6px 14px !important;
    border-radius: 20px !important;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3) !important;
    display: flex !important;
    align-items: center !important;
    gap: 7px !important;
    cursor: grab !important;
    user-select: none !important;
    pointer-events: auto !important;
    touch-action: none !important;
    transition: background 0.3s ease, box-shadow 0.2s ease, transform 0.1s ease !important;
  }
  #slop-filter-indicator.slop-dragging {
    cursor: grabbing !important;
    box-shadow: 0 10px 30px rgba(0,0,0,0.45) !important;
    opacity: 0.95 !important;
    transform: scale(1.03) !important;
    transition: none !important;
  }
  .slop-drag-handle {
    cursor: grab !important;
    opacity: 0.65 !important;
    font-size: 13px !important;
    line-height: 1 !important;
    user-select: none !important;
    margin-right: -1px !important;
  }
  .slop-drag-handle:hover {
    opacity: 1 !important;
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
  .slop-box-clean {
    position: relative !important;
    outline: 2px solid #27ae60 !important;
    outline-offset: -2px !important;
    border-radius: 8px !important;
  }
  .slop-box-hiring {
    position: relative !important;
    outline: 2px solid #0073b1 !important;
    outline-offset: -2px !important;
    border-radius: 8px !important;
    box-shadow: 0 0 10px rgba(0, 115, 177, 0.25) !important;
  }
  @keyframes slop-hiring-glow {
    0% { outline-color: #0073b1; box-shadow: 0 0 0 rgba(0, 115, 177, 0); }
    50% { outline-color: #00a0dc; box-shadow: 0 0 22px rgba(0, 160, 220, 0.7); }
    100% { outline-color: #0073b1; box-shadow: 0 0 10px rgba(0, 115, 177, 0.25); }
  }
  .slop-hiring-pulse {
    animation: slop-hiring-glow 1.2s ease-in-out !important;
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
    right: 76px !important;
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
    white-space: nowrap !important;
  }
  .jev-badge-slop {
    background: rgba(217, 48, 37, 0.95) !important;
    color: #fff !important;
  }
  .jev-badge-clean {
    background: rgba(39, 174, 96, 0.9) !important;
    color: #fff !important;
  }
  .jev-badge-hiring {
    background: #0073b1 !important;
    color: #fff !important;
  }
  .jev-badge-pending {
    background: rgba(10, 102, 194, 0.9) !important;
    color: #fff !important;
  }
  .slop-divider {
    display: inline-block !important;
    width: 1px !important;
    height: 14px !important;
    background: rgba(255, 255, 255, 0.3) !important;
    margin: 0 4px !important;
  }
  .slop-hiring-cluster {
    display: inline-flex !important;
    align-items: center !important;
    gap: 4px !important;
  }
  .slop-hiring-btn {
    background: rgba(255, 255, 255, 0.2) !important;
    color: white !important;
    border: none !important;
    border-radius: 12px !important;
    padding: 3px 8px !important;
    font-size: 11px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 3px !important;
    transition: background 0.15s ease, transform 0.1s ease !important;
    user-select: none !important;
    font-family: inherit !important;
  }
  .slop-hiring-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.35) !important;
  }
  .slop-hiring-btn:disabled {
    opacity: 0.5 !important;
    cursor: not-allowed !important;
  }
  .slop-nav-btn {
    background: rgba(255, 255, 255, 0.2) !important;
    color: white !important;
    border: none !important;
    border-radius: 10px !important;
    width: 22px !important;
    height: 20px !important;
    font-size: 10px !important;
    font-weight: bold !important;
    cursor: pointer !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    transition: background 0.15s ease, transform 0.1s ease !important;
    user-select: none !important;
    padding: 0 !important;
    font-family: inherit !important;
  }
  .slop-nav-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.35) !important;
    transform: scale(1.08) !important;
  }
  .slop-nav-btn:active:not(:disabled) {
    transform: scale(0.92) !important;
  }
  .slop-nav-btn:disabled {
    opacity: 0.35 !important;
    cursor: not-allowed !important;
  }
`;
document.head.appendChild(style);

// --- Indicator widget & Hiring Navigator -----------------------------------

let scannedCount = 0;
let fadedCount = 0;
let indicatorEl = null;
const hiringPosts = [];
let currentHiringIndex = -1;

function updateHiringNavUI() {
  const trigger = document.getElementById("slop-hiring-trigger");
  const prevBtn = document.getElementById("slop-prev-hiring");
  const nextBtn = document.getElementById("slop-next-hiring");
  if (!trigger || !prevBtn || !nextBtn) return;

  const validPosts = hiringPosts.filter(el => el && el.isConnected);
  const count = validPosts.length;

  if (count === 0) {
    trigger.textContent = "💼 Hiring (0)";
    trigger.disabled = true;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
  } else {
    trigger.disabled = false;
    prevBtn.disabled = false;
    nextBtn.disabled = false;
    if (currentHiringIndex >= 0 && currentHiringIndex < count) {
      trigger.textContent = `💼 Hiring ${currentHiringIndex + 1}/${count}`;
    } else {
      trigger.textContent = `💼 Hiring (${count})`;
    }
  }
}

function goToNextHiringPost() {
  const validPosts = hiringPosts.filter(el => el && el.isConnected);
  if (!validPosts.length) return;

  currentHiringIndex = (currentHiringIndex + 1) % validPosts.length;
  scrollToHiringPost(validPosts[currentHiringIndex]);
  updateHiringNavUI();
}

function goToPrevHiringPost() {
  const validPosts = hiringPosts.filter(el => el && el.isConnected);
  if (!validPosts.length) return;

  currentHiringIndex = (currentHiringIndex - 1 + validPosts.length) % validPosts.length;
  scrollToHiringPost(validPosts[currentHiringIndex]);
  updateHiringNavUI();
}

function scrollToHiringPost(postEl) {
  if (!postEl) return;
  postEl.scrollIntoView({ behavior: "smooth", block: "center" });
  postEl.classList.remove("slop-hiring-pulse");
  void postEl.offsetWidth; // trigger reflow for animation restart
  postEl.classList.add("slop-hiring-pulse");
  setTimeout(() => {
    if (postEl.isConnected) postEl.classList.remove("slop-hiring-pulse");
  }, 1300);
}

function makeDraggable(el) {
  let isDragging = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;
  let hasMoved = false;

  // Restore saved position if available
  try {
    const saved = localStorage.getItem("slop_indicator_pos");
    if (saved) {
      const pos = JSON.parse(saved);
      if (typeof pos.top === "number" && typeof pos.left === "number") {
        const maxTop = window.innerHeight - 50;
        const maxLeft = window.innerWidth - 100;
        const boundedTop = Math.max(10, Math.min(pos.top, maxTop));
        const boundedLeft = Math.max(10, Math.min(pos.left, maxLeft));
        el.style.top = `${boundedTop}px`;
        el.style.left = `${boundedLeft}px`;
        el.style.bottom = "auto";
        el.style.right = "auto";
      }
    }
  } catch (e) {}

  el.addEventListener("pointerdown", (e) => {
    // Never start a drag when clicking buttons inside the widget
    if (e.target.closest("button, .slop-nav-btn, .slop-hiring-btn")) {
      return;
    }

    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;

    const rect = el.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {}
    el.classList.add("slop-dragging");
  });

  el.addEventListener("pointermove", (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMoved = true;
    }

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    // Viewport bounds constraint with padding
    const maxLeft = window.innerWidth - el.offsetWidth - 8;
    const maxTop = window.innerHeight - el.offsetHeight - 8;

    newLeft = Math.max(8, Math.min(newLeft, maxLeft));
    newTop = Math.max(8, Math.min(newTop, maxTop));

    el.style.left = `${newLeft}px`;
    el.style.top = `${newTop}px`;
    el.style.bottom = "auto";
    el.style.right = "auto";
  });

  const onPointerEnd = (e) => {
    if (!isDragging) return;
    isDragging = false;
    el.classList.remove("slop-dragging");
    try {
      el.releasePointerCapture(e.pointerId);
    } catch (err) {}

    if (hasMoved) {
      try {
        const rect = el.getBoundingClientRect();
        localStorage.setItem("slop_indicator_pos", JSON.stringify({
          top: Math.round(rect.top),
          left: Math.round(rect.left)
        }));
      } catch (err) {}
    }
  };

  el.addEventListener("pointerup", onPointerEnd);
  el.addEventListener("pointercancel", onPointerEnd);
}

function updateIndicator(msg, status = "active") {
  if (!indicatorEl) {
    indicatorEl = document.createElement("div");
    indicatorEl.id = "slop-filter-indicator";
    indicatorEl.innerHTML = `
      <span class="slop-drag-handle" title="Drag to reposition">⠿</span>
      <span id="slop-status-text">🛡️ ${msg}</span>
      <span class="slop-divider"></span>
      <span id="slop-hiring-cluster" class="slop-hiring-cluster">
        <button id="slop-hiring-trigger" class="slop-hiring-btn" title="Jump to next hiring post" disabled>💼 Hiring (0)</button>
        <button id="slop-prev-hiring" class="slop-nav-btn" title="Previous hiring post" disabled>◀</button>
        <button id="slop-next-hiring" class="slop-nav-btn" title="Next hiring post" disabled>▶</button>
      </span>
    `;
    document.body.appendChild(indicatorEl);

    makeDraggable(indicatorEl);

    document.getElementById("slop-hiring-trigger")?.addEventListener("click", (e) => {
      e.stopPropagation();
      goToNextHiringPost();
    });
    document.getElementById("slop-next-hiring")?.addEventListener("click", (e) => {
      e.stopPropagation();
      goToNextHiringPost();
    });
    document.getElementById("slop-prev-hiring")?.addEventListener("click", (e) => {
      e.stopPropagation();
      goToPrevHiringPost();
    });
  } else {
    const statusSpan = document.getElementById("slop-status-text");
    if (statusSpan) {
      statusSpan.textContent = `🛡️ ${msg}`;
    }
  }

  if (status === "error") {
    indicatorEl.style.background = "#d93025";
  } else if (status === "disabled") {
    indicatorEl.style.background = "#5f6368";
  } else {
    indicatorEl.style.background = "#0a66c2";
  }

  updateHiringNavUI();
}

updateIndicator("Slop Filter: Active");

// --- Settings --------------------------------------------------------------

let ENABLED   = true;
let THRESHOLD = 0.75;

chrome.storage.sync.get({ enabled: true, threshold: 0.75 }, s => {
  ENABLED   = s.enabled;
  THRESHOLD = s.threshold;
  if (!ENABLED) updateIndicator("Slop Filter Disabled", "disabled");
  console.log(`[Feed Slop Filter] Settings loaded: enabled=${ENABLED}, threshold=${THRESHOLD}`);
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.enabled) {
    ENABLED = changes.enabled.newValue;
    console.log(`[Feed Slop Filter] Enabled state updated: ${ENABLED}`);
  }
  if (changes.threshold) {
    THRESHOLD = changes.threshold.newValue;
    console.log(`[Feed Slop Filter] Threshold updated: ${THRESHOLD}`);
  }
});

// --- DOM helpers -----------------------------------------------------------

function isExcludedWidget(el) {
  if (!el || el === document.body || el.tagName === "MAIN") return true;

  // 1. "Start a post" creation box (match class, data attribute, or trigger)
  if (
    el.classList.contains("share-box-feed-entry") ||
    el.classList.contains("share-box-feed-entry__wrapper") ||
    el.classList.contains("share-box-feed-entry__trigger") ||
    el.querySelector(".share-box-feed-entry__trigger") ||
    el.querySelector("[data-view-name*='feed-creation']") ||
    el.querySelector(".share-box-feed-entry")
  ) {
    return true;
  }

  const text = el.textContent || "";
  if (
    /Start\s+a\s+post/i.test(text) &&
    !el.querySelector("button[aria-label*='Like' i], button[aria-label*='React' i], button[aria-label*='Comment' i]")
  ) {
    return true;
  }

  // 2. Feed news, side modules, puzzles, and loading indicators
  if (
    el.classList.contains("feed-shared-news-module") ||
    el.classList.contains("scaffold-finite-scroll__loading-indicator") ||
    el.querySelector(".feed-shared-news-module") ||
    /Today[’']s puzzles/i.test(text) ||
    /Jobs recommended for you/i.test(text)
  ) {
    return true;
  }

  // 3. The entire feed container itself is not an individual post
  if (
    el.classList.contains("scaffold-finite-scroll") ||
    el.classList.contains("scaffold-finite-scroll__content")
  ) {
    return true;
  }

  return false;
}

function findPosts(root = document) {
  if (document.hidden) return [];
  const posts = new Set();

  // Strategy 1: Action buttons (Like, React, Comment, Repost)
  // Legitimate LinkedIn posts ALWAYS contain social action buttons.
  try {
    const actionButtons = root.querySelectorAll(
      "button[aria-label*='Like' i], button[aria-label*='React' i], button[aria-label*='Comment' i], button[aria-label*='Repost' i], " +
      "[role='button'][aria-label*='Like' i], [role='button'][aria-label*='React' i]"
    );

    for (const btn of actionButtons) {
      // Skip buttons that are inside comment sections
      if (btn.closest(".comments-comment-item, .comments-comments-list, .feed-shared-inline-comments")) {
        continue;
      }

      // 1a. Direct child of feed content is always the exact post card
      const directFeedItem = btn.closest(".scaffold-finite-scroll__content > *");
      if (directFeedItem) {
        if (!isExcludedWidget(directFeedItem)) {
          posts.add(directFeedItem);
        }
        continue;
      }

      // 1b. Fallback: Walk up until reaching a post card boundary
      let p = btn.parentElement;
      let candidate = null;
      while (p && p !== document.body && p.tagName !== "MAIN") {
        if (p.classList.contains("scaffold-finite-scroll") || p.classList.contains("scaffold-finite-scroll__content")) {
          break;
        }

        // Avoid selecting internal reaction bar wrappers
        const isInternalBar = p.classList.contains("feed-shared-social-action-bar") ||
                              p.classList.contains("social-details-social-actions") ||
                              p.classList.contains("feed-shared-social-actions");
        if (!isInternalBar) {
          if (
            p.classList.contains("feed-shared-update-v2") ||
            p.getAttribute("role") === "listitem" ||
            p.getAttribute("data-urn") ||
            p.getAttribute("data-id") ||
            p.getAttribute("data-view-name")?.includes("feed-full-update") ||
            p.tagName === "ARTICLE"
          ) {
            candidate = p;
            break;
          }
          if (p.offsetHeight >= 120 && p.offsetWidth >= 250 && !candidate) {
            candidate = p;
          }
        }
        p = p.parentElement;
      }
      if (candidate && !isExcludedWidget(candidate)) {
        posts.add(candidate);
      }
    }
  } catch (e) {}

  // Strategy 2: Direct query for update containers (supports demo page and direct feed cards)
  try {
    root.querySelectorAll(
      "article.feed-shared-update-v2, .feed-shared-update-v2, [data-view-name*='feed-full-update']"
    ).forEach(el => {
      if (el.offsetHeight >= 120 && !isExcludedWidget(el)) {
        posts.add(el);
      }
    });
  } catch (e) {}

  // Strategy 3: Substack post cards (feed, inbox, archive pages)
  if (CURRENT_SITE === "substack") {
    try {
      root.querySelectorAll(
        "article, .post-preview, [class*='post-preview'], [class*='inbox-item'], [data-testid='post-preview']"
      ).forEach(el => {
        if (el.offsetHeight >= 80 && (el.textContent?.trim().length ?? 0) > 30) {
          posts.add(el);
        }
      });
    } catch (e) {}
  }

  // Strategy 4: Generic <article> fallback for any other site
  if (CURRENT_SITE === "generic" && posts.size === 0) {
    try {
      root.querySelectorAll("article, [role='article']").forEach(el => {
        if (el.offsetHeight >= 100 && (el.textContent?.trim().length ?? 0) > 50) {
          posts.add(el);
        }
      });
    } catch (e) {}
  }

  // Deduplication: Discard inner elements if an outer containing post card is also present
  const rawList = Array.from(posts);
  return rawList.filter(el => {
    if (isExcludedWidget(el)) return false;
    for (const other of rawList) {
      if (other !== el && other.contains(el)) {
        return false; // keep the outer container
      }
    }
    return true;
  });
}

function extractText(post) {
  if (isExcludedWidget(post)) return null;

  // 1. Try known specific text selectors for post body
  const selectors = CURRENT_SITE === "substack" ? [
    ".post-preview-description",
    ".subtitle",
    ".post-preview-title",
    ".body.markup",
    ".post-body",
    "h2 ~ p",
    "p"
  ] : [
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

const POSITION_REGEX = /\b(?:software|frontend|front-end|backend|back-end|fullstack|full-stack|mobile|ios|android|ml|ai|machine learning|data|systems?|infrastructure|platform|cloud|security|devops|sre|qa|test|product|program|project|engineering|design|ui|ux|brand|sales|account|marketing|growth|content|talent|people|hr|finance|operations|bizops|legal)\s*(?:engineer(?:ing|s)?|developer(?:s)?|manager(?:s)?|pm|lead(?:s)?|director(?:s)?|vp|head|architect(?:s)?|designer(?:s)?|scientist(?:s)?|analyst(?:s)?|executive(?:s)?|specialist(?:s)?|recruiter(?:s)?|intern(?:s)?|associate(?:s)?|consultant(?:s)?)\b|\b(?:software engineer|product manager|data scientist|account executive|engineering manager|solution architect|product designer|cto|cpo|vp of engineering)\b/i;

const HIRING_INTENT_REGEX = /\b(?:we(?:'re| are)|\bi(?:'m| am)|my team is|our team is)\s+(?:hiring|recruiting|looking for)\b|\bjoin (?:our|my) team as\b|\bopen role(?:s)?\b|\bjob opening(?:s)?\b|\bwe have open position(?:s)?\b/i;

function hasSpecificJobPosition(text) {
  if (!text) return false;
  return (HIRING_INTENT_REGEX.test(text) && POSITION_REGEX.test(text)) ||
         /\b(?:open roles?|open positions?|hiring for)\s*[:\-]\s*[A-Za-z]/i.test(text);
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
  if (id) {
    post.querySelectorAll(`[data-badge-id="${id}"]`).forEach(el => el.remove());
  }
  post.querySelectorAll(".jev-badge").forEach(el => el.remove());
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
  console.log(`[Feed Slop Filter] Enqueued post ${id}: "${text.slice(0, 50).replace(/\n/g, ' ')}..."`);
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
  console.log(`[Feed Slop Filter] Classifying batch of ${batch.length} posts...`);

  chrome.runtime.sendMessage(
    { type: "classify", posts: batch.map(p => ({ id: p.id, text: p.text })) },
    resp => {
      isFlushing = false;

      if (chrome.runtime.lastError) {
        console.error("[Feed Slop Filter] Background message error:", chrome.runtime.lastError.message);
        cleanup(batch);
        if (queue.length) scheduleFlush();
        return;
      }
      if (!resp) {
        console.warn("[Feed Slop Filter] Empty response from background worker");
        cleanup(batch);
        if (queue.length) scheduleFlush();
        return;
      }
      if (resp.error) {
        console.error("[Feed Slop Filter] Backend returned error:", resp.error);
        updateIndicator("Slop Filter: Backend Error", "error");
        cleanup(batch);
        if (queue.length) scheduleFlush();
        return;
      }

      const threshold = resp.threshold ?? THRESHOLD;
      console.log(`[Feed Slop Filter] Received classification results for ${resp.results?.length || 0} posts (threshold=${threshold})`);

      for (const result of (resp.results ?? [])) {
        const item = batch.find(p => p.id === result.id);
        if (!item || !item.el || !item.el.isConnected) continue;

        item.el.classList.remove("slop-box-scanning");
        removeBadge(item.el, item.id);

        if (result.error) {
          console.warn(`[Feed Slop Filter] Post ${result.id} classification error:`, result.error);
          // Graceful fallback to clean state so the box/badge don't abruptly vanish
          item.el.classList.add("slop-box-clean");
          setBadge(item.el, item.id, `✓ 0% slop`, "jev-badge-clean");
          continue;
        }

        const hasPosition = CURRENT_SITE === "linkedin" && hasSpecificJobPosition(item.text);
        const isHiring = CURRENT_SITE === "linkedin" && Boolean(result.is_hiring && hasPosition);
        const score = isHiring ? 0 : (result.noul ?? 0);
        const pct = Math.round(score * 100);
        console.log(`[Feed Slop Filter] Post ${result.id} -> slop=${result.slop}, ad=${result.ad}, hiring=${result.hiring}, hasPosition=${hasPosition}, isHiring=${isHiring}`);

        // Transition progress icon to %slop / Hiring and update square outline
        if (isHiring) {
          item.el.classList.add("slop-box-hiring");
          setBadge(item.el, item.id, "💼 Hiring", "jev-badge-hiring");
          if (!hiringPosts.includes(item.el)) {
            hiringPosts.push(item.el);
            updateHiringNavUI();
          }
          console.log(`[Feed Slop Filter] Marked post ${result.id} as Hiring`);
        } else if (score >= threshold) {
          item.el.classList.add("slop-box-slop");
          item.el.classList.add(FADE_CLASS);
          const label = result.ad > result.slop ? `📢 ${pct}% ad` : `⚠️ ${pct}% slop`;
          setBadge(item.el, item.id, label, "jev-badge-slop");
          fadedCount++;
          console.log(`[Feed Slop Filter] Faded post ${result.id} with label "${label}"`);
        } else {
          // Clean post: transition blue dashed square to green solid square, and spinner to checkmark badge
          item.el.classList.add("slop-box-clean");
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
      p.el.classList.remove("slop-box-scanning");
      p.el.classList.add("slop-box-clean");
      setBadge(p.el, p.id, `✓ 0% slop`, "jev-badge-clean");
    }
  });
}

// --- Automatic Infinite Scroll Continuity -----------------------------------

function checkAndTriggerInfiniteScroll() {
  try {
    const loadButtons = document.querySelectorAll(
      ".scaffold-finite-scroll__load-button, button[data-view-name*='load-more'], button[data-view-name*='finite-scroll'], button.artdeco-button--secondary"
    );
    for (const btn of loadButtons) {
      if (btn.offsetParent !== null && /load more|show more/i.test(btn.textContent || "")) {
        btn.click();
        break;
      }
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
