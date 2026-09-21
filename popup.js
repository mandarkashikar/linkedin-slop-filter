const $ = id => document.getElementById(id);

let enabled = true;

// Load saved settings
chrome.storage.sync.get({ apiKey: "", threshold: 0.75, enabled: true }, s => {
  $("apiKey").value = s.apiKey;
  $("threshold").value = Math.round(s.threshold * 100);
  $("threshVal").textContent = `${Math.round(s.threshold * 100)}%`;
  setToggle(s.enabled);
});

// Threshold slider live update
$("threshold").addEventListener("input", () => {
  $("threshVal").textContent = `${$("threshold").value}%`;
});

// Toggle
function setToggle(val) {
  enabled = val;
  $("toggle").classList.toggle("on", val);
  $("toggleLabel").textContent = val ? "on" : "off";
}

$("toggle").addEventListener("click", () => setToggle(!enabled));

// Save
$("save").addEventListener("click", () => {
  const apiKey   = $("apiKey").value.trim();
  const threshold = parseInt($("threshold").value, 10) / 100;

  chrome.storage.sync.set({ apiKey, threshold, enabled }, () => {
    const st = $("status");
    if (!apiKey) {
      st.textContent = "Add a Jev API key to activate filtering.";
      st.className = "status err";
    } else {
      st.textContent = "Saved — reload LinkedIn to apply.";
      st.className = "status ok";
    }
    setTimeout(() => { st.textContent = ""; st.className = "status"; }, 3000);
  });
});
