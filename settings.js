const KEY = "emAuditMonitor.settings.v1";
const DEFAULTS = Object.freeze({
  appTitle: "Emergency Management Audit Monitor",
  subtitle: "Read-only change history and source-feature locator",
  defaultDays: 7,
  pageSize: 200,
  basemap: "webmap",
  showSolutionLink: true
});
const DAYS = new Set([1, 7, 14, 30, 90]);
const PAGE_SIZES = new Set([50, 100, 200, 500]);
const BASEMAPS = new Set(["webmap", "dark-gray-vector", "gray-vector", "streets-vector", "topo-vector", "satellite"]);
const $ = (id) => document.getElementById(id);

function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Settings must be a JSON object.");
  const appTitle = String(value.appTitle ?? DEFAULTS.appTitle).trim();
  const subtitle = String(value.subtitle ?? DEFAULTS.subtitle).trim();
  const defaultDays = Number(value.defaultDays ?? DEFAULTS.defaultDays);
  const pageSize = Number(value.pageSize ?? DEFAULTS.pageSize);
  const basemap = String(value.basemap ?? DEFAULTS.basemap);
  if (!appTitle || appTitle.length > 80) throw new Error("Application title must contain 1–80 characters.");
  if (!subtitle || subtitle.length > 140) throw new Error("Subtitle must contain 1–140 characters.");
  if (!DAYS.has(defaultDays)) throw new Error("Default date window is not supported.");
  if (!PAGE_SIZES.has(pageSize)) throw new Error("Rows per request is not supported.");
  if (!BASEMAPS.has(basemap)) throw new Error("Basemap is not supported.");
  return { appTitle, subtitle, defaultDays, pageSize, basemap, showSolutionLink: value.showSolutionLink !== false };
}

function load() {
  try { return validate(JSON.parse(localStorage.getItem(KEY) || "{}")); }
  catch { return { ...DEFAULTS }; }
}

function render(settings) {
  $("appTitleInput").value = settings.appTitle;
  $("subtitleInput").value = settings.subtitle;
  $("defaultDaysInput").value = String(settings.defaultDays);
  $("pageSizeInput").value = String(settings.pageSize);
  $("basemapInput").value = settings.basemap;
  $("showSolutionLinkInput").checked = settings.showSolutionLink;
  $("settingsAppTitle").textContent = settings.appTitle;
  document.title = `${settings.appTitle} Settings`;
}

function collect() {
  return validate({
    appTitle: $("appTitleInput").value,
    subtitle: $("subtitleInput").value,
    defaultDays: $("defaultDaysInput").value,
    pageSize: $("pageSizeInput").value,
    basemap: $("basemapInput").value,
    showSolutionLink: $("showSolutionLinkInput").checked
  });
}

function show(message, kind = "") {
  $("settingsMessage").textContent = message;
  $("settingsMessage").className = `settings-message ${kind}`.trim();
}

function save() {
  try {
    const settings = collect();
    localStorage.setItem(KEY, JSON.stringify(settings));
    render(settings);
    show("Settings saved. Reload the Audit Monitor to apply them.", "is-success");
  } catch (error) { show(error.message, "is-error"); }
}

function reset() {
  localStorage.removeItem(KEY);
  render({ ...DEFAULTS });
  show("Defaults restored. Reload the Audit Monitor to apply them.", "is-success");
}

function exportSettings() {
  try {
    const blob = new Blob([JSON.stringify(collect(), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "em-audit-monitor-settings.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 500);
    show("Settings JSON exported.", "is-success");
  } catch (error) { show(error.message, "is-error"); }
}

async function importSettings(file) {
  if (!file) return;
  try {
    const settings = validate(JSON.parse(await file.text()));
    localStorage.setItem(KEY, JSON.stringify(settings));
    render(settings);
    show("Settings imported and saved. Reload the Audit Monitor to apply them.", "is-success");
  } catch (error) { show(`Import failed: ${error.message}`, "is-error"); }
  finally { $("importSettings").value = ""; }
}

function selectTab(name, updateHash = true) {
  const help = name === "help";
  $("configurationTab").setAttribute("aria-selected", String(!help));
  $("helpTab").setAttribute("aria-selected", String(help));
  $("configurationPanel").hidden = help;
  $("helpPanel").hidden = !help;
  if (updateHash) history.replaceState(null, "", help ? "#help" : "#configuration");
}

function applyHash() {
  const hash = location.hash || "#configuration";
  const help = hash === "#help" || hash.startsWith("#help-");
  selectTab(help ? "help" : "configuration", false);
  if (help && hash.startsWith("#help-")) requestAnimationFrame(() => document.querySelector(hash)?.scrollIntoView());
}

function main() {
  render(load());
  $("configurationTab").addEventListener("click", () => selectTab("configuration"));
  $("helpTab").addEventListener("click", () => selectTab("help"));
  $("saveSettings").addEventListener("click", save);
  $("resetSettings").addEventListener("click", reset);
  $("exportSettings").addEventListener("click", exportSettings);
  $("importSettings").addEventListener("change", (event) => importSettings(event.target.files?.[0]));
  addEventListener("hashchange", applyHash);
  applyHash();
}

main();
