const $ = id => document.getElementById(id);

let enabled = true;

// Load saved settings
chrome.storage.sync.get(
  { apiKey: "", threshold: 0.75, enabled: true, backend: "ollama", ollamaModel: "llama3.2" },
  s => {
    $("apiKey").value = s.apiKey;
    const model = (!s.ollamaModel || s.ollamaModel === "gemma4") ? "llama3.2" : s.ollamaModel;
    $("ollamaModel").value = model;
    $("threshold").value = Math.round(s.threshold * 100);
    $("threshVal").textContent = `${Math.round(s.threshold * 100)}%`;
    setToggle(s.enabled);
    setBackend(s.backend);
    checkOllamaStatus(model);
  }
);

async function checkOllamaStatus(currentModel) {
  const hint = $("ollamaStatusHint");
  if (!hint) return;
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    hint.innerHTML = `<span style="color:#27ae60;font-weight:600;">✓ Connected to Ollama</span> (${models.length ? models.join(", ") : "no models installed"})`;
  } catch (e) {
    hint.innerHTML = `<span style="color:#e74c3c;font-weight:600;">✗ Cannot reach Ollama at localhost:11434</span>`;
  }
}

// Backend switcher
$("backend").addEventListener("change", () => setBackend($("backend").value));

function setBackend(val) {
  $("backend").value = val;
  $("ollamaModelField").classList.toggle("hidden", val !== "ollama");
  $("jevKeyField").classList.toggle("hidden", val !== "jev");
}

// Threshold slider
$("threshold").addEventListener("input", () => {
  $("threshVal").textContent = `${$("threshold").value}%`;
});

// On/off toggle
function setToggle(val) {
  enabled = val;
  $("toggle").classList.toggle("on", val);
  $("toggleLabel").textContent = val ? "on" : "off";
}
$("toggle").addEventListener("click", () => setToggle(!enabled));

// Save
$("save").addEventListener("click", () => {
  const backend     = $("backend").value;
  const apiKey      = $("apiKey").value.trim();
  const ollamaModel = $("ollamaModel").value.trim() || "llama3.2";
  const threshold   = parseInt($("threshold").value, 10) / 100;
  const st          = $("status");

  chrome.storage.sync.set({ apiKey, threshold, enabled, backend, ollamaModel }, () => {
    if (backend === "jev" && !apiKey) {
      st.textContent = "Add a Jev API key to activate filtering.";
      st.className = "status err";
    } else {
      st.textContent = "Saved — reload LinkedIn to apply.";
      st.className = "status ok";
    }
    setTimeout(() => { st.textContent = ""; st.className = "status"; }, 3000);
  });
});
