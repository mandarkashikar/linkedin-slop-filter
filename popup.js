const $ = id => document.getElementById(id);

let enabled = true;

// Load saved settings
chrome.storage.sync.get(
  { apiKey: "", threshold: 0.75, enabled: true, backend: "ollama", ollamaModel: "gemma4" },
  s => {
    $("apiKey").value       = s.apiKey;
    $("ollamaModel").value  = s.ollamaModel;
    $("threshold").value    = Math.round(s.threshold * 100);
    $("threshVal").textContent = `${Math.round(s.threshold * 100)}%`;
    setToggle(s.enabled);
    setBackend(s.backend);
  }
);

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
  const ollamaModel = $("ollamaModel").value.trim() || "gemma4";
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
