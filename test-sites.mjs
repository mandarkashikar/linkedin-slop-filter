/**
 * Feed Slop Filter — site tester
 * Fetches real pages, runs the extension's selector logic, classifies via Ollama.
 * Usage: node test-sites.mjs
 */

import { JSDOM } from "jsdom";

const OLLAMA_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "gemma4";
const THRESHOLD = 0.6;

// ---- Mirrored from content.js -----------------------------------------------

const SUBSTACK_TEXT_SELECTORS = [
  ".post-preview-description",
  ".subtitle",
  ".post-preview-title",
  ".body.markup",
  ".post-body",
  "h2 ~ p",
  "p",
];

function detectSite(url) {
  if (url.includes("linkedin.com")) return "linkedin";
  if (url.includes("substack.com") || url.includes(".substack.com")) return "substack";
  if (url.includes("twitter.com") || url.includes("x.com")) return "twitter";
  return "generic";
}

function findPostsSubstack(doc) {
  const posts = new Set();
  doc.querySelectorAll(
    "article, .post-preview, [class*='post-preview'], [class*='inbox-item']"
  ).forEach(el => {
    const text = el.textContent?.trim() ?? "";
    if (text.length > 30) posts.add(el);
  });
  return dedup([...posts]);
}

function findPostsGeneric(doc) {
  const posts = [];
  doc.querySelectorAll("article, [role='article']").forEach(el => {
    if ((el.textContent?.trim().length ?? 0) > 50) posts.push(el);
  });
  return dedup(posts);
}

function dedup(list) {
  return list.filter(el => !list.some(other => other !== el && other.contains(el)));
}

function extractText(el, site) {
  const selectors = site === "substack" ? SUBSTACK_TEXT_SELECTORS : ["p", ".content", "h2"];
  for (const sel of selectors) {
    const found = el.querySelector(sel);
    if (found) {
      const t = found.textContent?.trim();
      if (t && t.length > 15) return t;
    }
  }
  const full = el.textContent?.trim() ?? "";
  return full.length > 15 ? full.slice(0, 800) : null;
}

// ---- Classifier (direct Ollama) ---------------------------------------------

async function classify(text) {
  const prompt = `You are a social feed post classifier. Analyze the following post and return ONLY a JSON object with:
- "slop": float 0.0–1.0 — how much this is AI-generated filler, thought-leader platitudes, vague inspiration, or generic advice with no original insight
- "ad": float 0.0–1.0 — how much this is promotional advertising or sponsored content

Post:
"""
${text.slice(0, 1200)}
"""

Respond with ONLY the JSON object.`;

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, format: "json" }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.response);
  const slop = Math.min(1, Math.max(0, parseFloat(parsed.slop) || 0));
  const ad   = Math.min(1, Math.max(0, parseFloat(parsed.ad)   || 0));
  return { slop, ad, score: Math.max(slop, ad) };
}

// ---- Fetch page -------------------------------------------------------------

async function fetchPage(url) {
  console.log(`\nFetching: ${url}`);
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate",
    },
  });
  console.log(`  → ${res.status} ${res.url} (${res.headers.get("content-type") ?? "no content-type"})`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---- Test runner ------------------------------------------------------------

async function testSite(url) {
  const site = detectSite(url);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Site: ${site.toUpperCase()} — ${url}`);
  console.log("=".repeat(60));

  let html;
  try {
    html = await fetchPage(url);
  } catch (e) {
    console.log(`  ✗ Fetch failed: ${e.message}`);
    return;
  }

  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const posts = site === "substack" ? findPostsSubstack(doc) : findPostsGeneric(doc);
  console.log(`  Found ${posts.length} post element(s)`);

  if (posts.length === 0) {
    // Show what elements ARE on the page for debugging
    const articles = doc.querySelectorAll("article");
    const divs = doc.querySelectorAll("[class*='post']");
    console.log(`  Debug: ${articles.length} <article> tags, ${divs.length} [class*=post] divs`);
    const bodySnip = doc.body?.textContent?.trim().slice(0, 200).replace(/\s+/g, " ");
    console.log(`  Page text preview: ${bodySnip}`);
    return;
  }

  const toTest = posts.slice(0, 5); // cap at 5 per site
  for (let i = 0; i < toTest.length; i++) {
    const post = toTest[i];
    const text = extractText(post, site);
    if (!text) {
      console.log(`  [${i+1}] No text extracted`);
      continue;
    }

    const preview = text.slice(0, 100).replace(/\n/g, " ").trim();
    process.stdout.write(`  [${i+1}] "${preview}…"\n       classifying…`);

    try {
      const result = await classify(text);
      const verdict = result.score >= THRESHOLD
        ? (result.ad > result.slop ? `📢 AD   ${Math.round(result.ad*100)}%` : `⚠️  SLOP ${Math.round(result.slop*100)}%`)
        : `✓  CLEAN ${Math.round(result.score*100)}%`;
      process.stdout.write(`\r  [${i+1}] ${verdict}  — "${preview}…"\n`);
    } catch (e) {
      process.stdout.write(`\r  [${i+1}] ✗ classify error: ${e.message}\n`);
    }
  }
}

// ---- Main ------------------------------------------------------------------

const SITES = [
  // Substack — individual post archive pages (SSR, no login needed)
  "https://www.lennysnewsletter.com/archive",      // Lenny's Newsletter
  "https://www.theintrinsicperspective.com/",       // Erik Hoel
  "https://platformer.news/",                       // newsletter w/ real <article> tags
  "https://worksinprogress.co/",                    // ideas magazine, lots of articles
];

(async () => {
  console.log("Feed Slop Filter — site tester");
  console.log(`Classifier: Ollama / ${OLLAMA_MODEL}  Threshold: ${THRESHOLD}`);

  for (const url of SITES) {
    await testSite(url);
  }

  console.log("\n\nDone.");
})();
