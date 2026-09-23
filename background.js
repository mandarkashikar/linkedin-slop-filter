// Service worker — routes classification calls from content script.
// Supports two backends: Jev (TypeSafe AI) and local Ollama.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "classify") {
    classifyPosts(msg.posts)
      .then(resp => sendResponse(resp))
      .catch(err => {
        console.error("[Slop Filter Background] Error classifying posts:", err);
        sendResponse({ error: err.message });
      });
    return true; // Keep message channel open for async response
  }
});

async function classifyPosts(posts) {
  let { apiKey, threshold, backend, ollamaModel } = await chrome.storage.sync.get({
    apiKey: "",
    threshold: 0.75,
    backend: "ollama",
    ollamaModel: "llama3.2"
  });

  if (!ollamaModel || ollamaModel === "gemma4") {
    ollamaModel = "llama3.2";
  }

  if (backend === "ollama") {
    return classifyOllama(posts, threshold, ollamaModel);
  }

  if (!apiKey) return { error: "no_api_key" };
  return classifyJev(posts, apiKey, threshold);
}

// --- Jev (TypeSafe AI) -------------------------------------------------------

async function classifyJev(posts, apiKey, threshold) {
  const results = await Promise.all(
    posts.map(async ({ id, text }) => {
      try {
        const res = await fetch("https://api.typesafe.ai/v1/systemone", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "jev-latest",
            state: text.slice(0, 2000),
            questions: {
              is_slop: {
                type: "noul",
                instructions: "This post uses AI-generated language, vague inspirational filler, thought-leader platitudes, or generic advice with no original insight or lived experience"
              },
              is_ad: {
                type: "noul",
                instructions: "This post is primarily a promotional advertisement or commercial product pitch"
              },
              is_hiring: {
                type: "noul",
                instructions: "This post is announcing a job vacancy, team recruitment, or hiring for an open role"
              }
            }
          })
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${body.slice(0, 100)}`);
        }

        const data = await res.json();
        const slop = data.answers.is_slop?.noul ?? 0;
        const ad   = data.answers.is_ad?.noul ?? 0;
        let hiring = data.answers.is_hiring?.noul ?? 0;

        const hiringRegex = /\b(?:we(?:'re| are)|\bi(?:'m| am)|my team is|our team is)\s+(?:hiring|recruiting|looking for)\b|#hiring\b|\bopen role(?:s)?\b|\bjob opening(?:s)?\b/i;
        if (hiringRegex.test(text)) {
          hiring = Math.max(hiring, 0.85);
        }

        const isHiring = hiring >= 0.55 && hiring >= slop && hiring >= ad;
        const noul = isHiring ? 0 : Math.max(slop, ad);

        return { id, noul, slop, ad, hiring, is_hiring: isHiring };
      } catch (e) {
        return { id, error: e.message };
      }
    })
  );

  return { results, threshold };
}

// --- Ollama ------------------------------------------------------------------

const OLLAMA_PROMPT = (text) => `You are an expert LinkedIn feed curator. Analyze the post text below and rate it on three scales from 0.0 to 1.0:

1. "hiring" (0.0 to 1.0):
- HIGH (0.7–1.0):
  * The author or company is recruiting, hiring, or sharing open roles/vacancies ("We're hiring", "Looking for a PM to join our team", "My team has an open role", "Apply at link", "Hiring engineers in Toronto").
  * Sharing referral opportunities or recruiting for teams.
- LOW (0.0–0.2):
  * Not recruiting or hiring. (Note: A job seeker saying "I am looking for a job" is NOT hiring).

CRITICAL RULE: If a post is announcing a job opportunity or recruitment, it is a legitimate career opportunity. You MUST rate "hiring" HIGH (0.7–1.0) and "slop" and "ad" LOW (0.0–0.2). Do NOT classify hiring as a commercial ad!

2. "slop" (0.0 to 1.0):
- HIGH (0.7–1.0):
  * Low-effort AI-generated generic filler.
  * Empty thought-leader platitudes and generic motivational quotes ("Mindset is everything", "I woke up at 5 AM...").
  * Engagement bait ("Agree?", "Thoughts?", "Drop an emoji below").
  * Generic superficial lists ("Top 10 AI tools you must know 🚀") without original depth.
- LOW (0.0–0.2):
  * Authentic career milestones, engineering case studies, post-mortems, and team hiring announcements.

3. "ad" (0.0 to 1.0):
- HIGH (0.7–1.0):
  * Explicit sponsored advertising, paid promotional campaigns, commercial product sales pitches ("Book a demo today", "Use promo code", "Buy our course now").
  * Commercial lead generation funnels.
- LOW (0.0–0.2):
  * Legitimate team hiring announcements (job openings are NOT commercial ads!).
  * Organic founder updates or engineering articles.

4. "ui_noise": If the text appears to be UI navigation buttons, creation prompts (e.g. "Start a post", "Video Photo Write article"), or empty noise, return {"slop": 0.0, "ad": 0.0, "hiring": 0.0}.

Post text:
"""
${text.slice(0, 1500)}
"""

Return ONLY a JSON object with this exact format:
{"slop": <float between 0.0 and 1.0>, "ad": <float between 0.0 and 1.0>, "hiring": <float between 0.0 and 1.0>}`;

async function getAvailableOllamaModel(preferredModel) {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) return preferredModel;
    const data = await res.json();
    const models = (data.models || []).map(m => m.name.split(":")[0]);
    if (models.includes(preferredModel.split(":")[0])) {
      return preferredModel;
    }
    if (models.length > 0) {
      console.log(`[Slop Filter] Preferred model ${preferredModel} not found, falling back to installed:`, data.models[0].name);
      return data.models[0].name;
    }
  } catch (e) {
    console.warn("[Slop Filter] Could not query Ollama tags:", e.message);
  }
  return preferredModel;
}

async function classifyOllama(posts, threshold, model) {
  const actualModel = await getAvailableOllamaModel(model || "llama3.2");
  console.log(`[Slop Filter] Classifying ${posts.length} post(s) using Ollama (${actualModel})...`);

  const results = await Promise.all(
    posts.map(async ({ id, text }) => {
      try {
        const res = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: actualModel,
            prompt: OLLAMA_PROMPT(text),
            stream: false,
            format: "json"
          })
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.error(`[Slop Filter] Ollama error for post ${id} (HTTP ${res.status}):`, errBody);
          throw new Error(`Ollama HTTP ${res.status}: ${errBody}`);
        }

        const data = await res.json();
        console.log(`[Slop Filter] Ollama response for post ${id}:`, data.response);
        const parsed = safeParseJson(data.response) || {};
        const slop = clamp(parsed.slop ?? 0);
        const ad   = clamp(parsed.ad   ?? 0);
        let hiring = clamp(parsed.hiring ?? 0);

        // Fast keyword heuristic to reliably detect explicit hiring phrases
        const hiringRegex = /\b(?:we(?:'re| are)|\bi(?:'m| am)|my team is|our team is)\s+(?:hiring|recruiting|looking for)\b|#hiring\b|\bopen role(?:s)?\b|\bjob opening(?:s)?\b/i;
        if (hiringRegex.test(text)) {
          hiring = Math.max(hiring, 0.85);
        }

        const isHiring = hiring >= 0.55 && hiring >= slop && hiring >= ad;
        const noul = isHiring ? 0 : Math.max(slop, ad);

        return { id, noul, slop, ad, hiring, is_hiring: isHiring };
      } catch (e) {
        console.error(`[Slop Filter] Classification failed for post ${id}:`, e.message);
        return { id, error: e.message };
      }
    })
  );

  return { results, threshold };
}

function safeParseJson(raw) {
  if (!raw) return null;
  let cleaned = raw.trim();
  // Strip markdown code fences if present: ```json ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {}

  // Fallback: extract substring between first { and last }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (e) {}
  }
  return null;
}

function clamp(v) {
  return Math.min(1, Math.max(0, parseFloat(v) || 0));
}

