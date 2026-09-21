// Service worker — routes Jev API calls from content script
// (avoids CORS issues; service workers have full network access)

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "classify") {
    classifyPosts(msg.posts).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }
});

async function classifyPosts(posts) {
  const { apiKey, threshold } = await chrome.storage.sync.get({ apiKey: "", threshold: 0.75 });

  if (!apiKey) return { error: "no_api_key" };

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
