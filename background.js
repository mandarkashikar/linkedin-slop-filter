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
                instructions: "This post is primarily a promotional advertisement or sponsored content"
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
        return { id, noul: Math.max(slop, ad), slop, ad };
      } catch (e) {
        return { id, error: e.message };
      }
    })
  );

  return { results, threshold };
}

// --- Ollama ------------------------------------------------------------------

const OLLAMA_PROMPT = (text) => `You are an expert LinkedIn feed curator. Analyze the post text below and rate it on two scales from 0.0 to 1.0:

1. "slop" (0.0 to 1.0):
- HIGH (0.7–1.0):
  * Low-effort AI-generated generic filler.
  * Empty thought-leader platitudes and generic motivational quotes ("Mindset is everything", "I woke up at 5 AM...").
  * Engagement bait ("Agree?", "Thoughts?", "Drop an emoji below").
  * Generic superficial lists ("Top 10 AI tools you must know 🚀") without original depth.
- LOW (0.0–0.2):
  * Authentic career milestones ("Excited to share I joined Google...", "celebrating 3 years...").
  * Company acquisitions, funding announcements, or real business news ("Polarity was acquired by Wander").
  * Concrete engineering case studies, post-mortems, or technical questions with real details/metrics.
  * Organic personal reflections or stories with authentic human voice and specific details.

2. "ad" (0.0 to 1.0):
- HIGH (0.7–1.0):
  * Explicit sponsored advertising or promotional campaigns.
  * Aggressive product sales pitches ("Book a demo today", "Use promo code", "Buy our course now").
  * Lead generation funnels ("Comment 'INFO' to receive my free template").
- LOW (0.0–0.2):
  * Organic founder sharing what they built or asking for developer feedback.
  * Legitimate team hiring announcements ("We are hiring a Senior PM in Toronto").
  * General company/industry news or partnership announcements.

3. "ui_noise": If the text appears to be UI navigation buttons, creation prompts (e.g. "Start a post", "Video Photo Write article"), or empty noise, return {"slop": 0.0, "ad": 0.0}.

Post text:
"""
${text.slice(0, 1500)}
"""

Return ONLY a JSON object with this exact format:
{"slop": <float between 0.0 and 1.0>, "ad": <float between 0.0 and 1.0>}`;

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
        return { id, noul: Math.max(slop, ad), slop, ad };
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

