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

const OLLAMA_PROMPT = (text) => `You are a LinkedIn post classifier. Analyze the following post and return ONLY a JSON object with these two fields:
- "slop": float 0.0–1.0 — how much this post is AI-generated filler, thought-leader platitudes, vague inspiration, or generic advice with no original insight
- "ad": float 0.0–1.0 — how much this post is promotional advertising or sponsored content

Post:
"""
${text.slice(0, 1500)}
"""

Respond with ONLY the JSON object, nothing else.`;

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
        const parsed = JSON.parse(data.response);
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

function clamp(v) {
  return Math.min(1, Math.max(0, parseFloat(v) || 0));
}

