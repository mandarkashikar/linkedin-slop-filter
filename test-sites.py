#!/usr/bin/env python3
"""
Feed Slop Filter — site tester
Fetches real pages, extracts posts via BeautifulSoup, classifies via Ollama.

Usage:
  python3 test-sites.py                    # run default sites
  python3 test-sites.py https://example.com  # test a specific URL
"""

import json, re, sys, requests
from bs4 import BeautifulSoup

OLLAMA_URL   = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "gemma4"
THRESHOLD    = 0.60
MAX_POSTS    = 6

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# ── Post extraction ─────────────────────────────────────────────────────────

SKIP_TAGS = ["script", "style", "nav", "header", "footer", "aside",
             "button", "form", "noscript"]

def clean_text(el) -> str:
    """Get visible text from a BS4 element, skipping noise tags."""
    for tag in el.find_all(SKIP_TAGS):
        tag.decompose()
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True))

def extract_posts(soup: BeautifulSoup, site: str) -> list[str]:
    posts = []

    if site == "substack":
        candidates = (
            soup.find_all("article") +
            soup.find_all(class_=re.compile(r"post-preview|inbox-item"))
        )
    else:
        # Generic: <article> tags first, then any large <div> with a heading
        candidates = soup.find_all("article")
        if not candidates:
            candidates = [
                el for el in soup.find_all(["div", "section"])
                if el.find(["h1","h2","h3"]) and len(el.get_text()) > 100
            ]

    seen = set()
    for el in candidates:
        text = clean_text(el)
        if len(text) < 50:
            continue
        # Deduplicate: skip if mostly contained in a previously seen post
        key = text[:120]
        if key in seen:
            continue
        seen.add(key)
        # Skip if this element is contained in an already-found post
        parent_overlap = any(text in p for p in posts)
        if parent_overlap:
            continue
        posts.append(text[:1500])
        if len(posts) >= MAX_POSTS:
            break

    return posts

def detect_site(url: str) -> str:
    if "linkedin.com" in url: return "linkedin"
    if "substack.com" in url: return "substack"
    if "twitter.com" in url or "x.com" in url: return "twitter"
    return "generic"

# ── Classifier ───────────────────────────────────────────────────────────────

PROMPT = """\
You are a social feed post classifier. Analyze this post and return ONLY a JSON object:
- "slop": float 0.0-1.0 — AI-generated filler, thought-leader platitudes, vague inspiration, generic advice with no original insight
- "ad": float 0.0-1.0 — promotional advertising or sponsored content

Post:
\"\"\"
{text}
\"\"\"

Respond ONLY with the JSON object."""

def classify(text: str) -> dict:
    r = requests.post(
        OLLAMA_URL,
        json={"model": OLLAMA_MODEL,
              "prompt": PROMPT.format(text=text[:1200]),
              "stream": False, "format": "json"},
        timeout=90,
    )
    r.raise_for_status()
    d = json.loads(r.json()["response"])
    slop = max(0.0, min(1.0, float(d.get("slop", 0))))
    ad   = max(0.0, min(1.0, float(d.get("ad",   0))))
    return {"slop": slop, "ad": ad, "score": max(slop, ad)}

# ── Main ─────────────────────────────────────────────────────────────────────

def test_site(url: str):
    site = detect_site(url)
    print(f"\n{'='*62}")
    print(f"  {site.upper():10s} {url}")
    print("="*62)

    try:
        r = requests.get(url, headers=HEADERS, timeout=15, allow_redirects=True)
        r.raise_for_status()
    except Exception as e:
        print(f"  ✗ Fetch failed: {e}")
        return

    soup = BeautifulSoup(r.text, "html.parser")
    posts = extract_posts(soup, site)
    print(f"  Posts found: {len(posts)}")

    if not posts:
        # Debug info
        articles = len(soup.find_all("article"))
        h2s = len(soup.find_all("h2"))
        print(f"  (page has {articles} <article> tags, {h2s} <h2> tags — "
              f"content may be JS-rendered)")
        return

    for i, text in enumerate(posts, 1):
        preview = text[:90].replace("\n", " ").strip()
        print(f"\n  [{i}] \"{preview}…\"")
        try:
            result = classify(text)
            score  = result["score"]
            if score >= THRESHOLD:
                if result["ad"] > result["slop"]:
                    verdict = f"📢  AD   {round(result['ad']*100):3d}%"
                else:
                    verdict = f"⚠️   SLOP {round(result['slop']*100):3d}%"
            else:
                verdict = f"✓   CLEAN {round(score*100):3d}%"
            print(f"       → {verdict}")
        except Exception as e:
            print(f"       → ✗ {e}")


SITES = [
    # Static-HTML tech newsletters — article tags confirmed in initial HTML
    "https://www.platformer.news/",      # Casey Newton — 16 articles
    # Substack SPAs need a real browser; individual post URLs work if you have the slug:
    # "https://www.lennysnewsletter.com/p/<actual-slug>"
]

if __name__ == "__main__":
    urls = sys.argv[1:] or SITES
    print("Feed Slop Filter — site tester")
    print(f"Model: {OLLAMA_MODEL}   Threshold: {THRESHOLD}")
    for url in urls:
        test_site(url)
    print("\n\nDone.")
