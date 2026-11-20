const CONFIG = Object.freeze({
  portalUrl: "https://publicsafety.maps.arcgis.com",
  oauthClientId: "2eURPxapfMdaZiS7",
  oauthPopupCallbackUrl: "https://jonpedder.github.io/EM-Solutions-Audit-App/oauth-callback.html",
  webMapItemId: "960844e399eb4574a054cfb2e089ab4a",
  controlServiceItemId: "b66c382e79464d63a6ed2f078eb28215",
  auditTableName: "EM_Operations_Audit_Log",
  pageSize: 200
});

const SORT_FIELDS = new Set([
  "event_timestamp",
  "emergency_op_name",
  "service_name",
  "change_type",
  "authenticated_user"
]);

const els = Object.freeze({
  workspace: document.querySelector("#workspace"),
  identitySummary: document.querySelector("#identitySummary"),
  signInButton: document.querySelector("#signInButton"),
  signOutButton: document.querySelector("#signOutButton"),
  refreshButton: document.querySelector("#refreshButton"),
  filterForm: document.querySelector("#filterForm"),
  startDate: document.querySelector("#startDate"),
  endDate: document.querySelector("#endDate"),
  operationFilter: document.querySelector("#operationFilter"),
  serviceFilter: document.querySelector("#serviceFilter"),
  changeTypeFilter: document.querySelector("#changeTypeFilter"),
  applyFiltersButton: document.querySelector("#applyFiltersButton"),
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  signedOutState: document.querySelector("#signedOutState"),
  loadingState: document.querySelector("#loadingState"),
  errorState: document.querySelector("#errorState"),
  errorMessage: document.querySelector("#errorMessage"),
  emptyState: document.querySelector("#emptyState"),
  contentGrid: document.querySelector("#contentGrid"),
  auditTableBody: document.querySelector("#auditTableBody"),
  resultSummary: document.querySelector("#resultSummary"),
  truncationNote: document.querySelector("#truncationNote"),
  loadMoreButton: document.querySelector("#loadMoreButton"),
  kpiTotal: document.querySelector("#kpiTotal"),
  kpiAdds: document.querySelector("#kpiAdds"),
  kpiUpdates: document.querySelector("#kpiUpdates"),
  kpiDeletes: document.querySelector("#kpiDeletes"),
  auditMap: document.querySelector("#auditMap"),
  mapMessage: document.querySelector("#mapMessage"),
  detailEmpty: document.querySelector("#detailEmpty"),
  detailList: document.querySelector("#detailList"),
  changedFieldsSection: document.querySelector("#changedFieldsSection"),
  changedFields: document.querySelector("#changedFields"),
  fatalError: document.querySelector("#fatalError")
});

const state = {
  auditLayer: null,
  serviceUrl: null,
  records: [],
  recordByEventId: new Map(),
  sourceLayers: new Map(),
  mapGraphics: null,
  selectedEventId: null,
  sortField: "event_timestamp",
  sortDirection: "desc",
  nextStart: 0,
  hasMore: false,
  loading: false,
  mapInitialized: false
};

let OAuthInfo;
let esriId;
let Portal;
let PortalItem;
let WebMap;
let FeatureLayer;
let GraphicsLayer;
let Graphic;
let esriRequest;
let SimpleMarkerSymbol;
let SimpleLineSymbol;
let SimpleFillSymbol;
let oauthInfo;

function setDefaultDates() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  els.startDate.value = toDateInput(start);
  els.endDate.value = toDateInput(end);
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(date) + " UTC";
}

function displayValue(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

// ArcGIS standardized SQL escapes a string literal by doubling each apostrophe.
// All field names used by this app come from fixed allowlists or loaded layer metadata.
function escapeSqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function timestampLiteral(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function buildWhereClause() {
  const clauses = ["1=1"];
  const startText = els.startDate.value;
  const endText = els.endDate.value;

  if (startText) {
    const start = new Date(`${startText}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) throw new Error("The start date is invalid.");
    clauses.push(`event_timestamp >= TIMESTAMP '${timestampLiteral(start)}'`);
  }
  if (endText) {
    const endExclusive = new Date(`${endText}T00:00:00.000Z`);
    if (Number.isNaN(endExclusive.getTime())) throw new Error("The end date is invalid.");
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    clauses.push(`event_timestamp < TIMESTAMP '${timestampLiteral(endExclusive)}'`);
  }
  if (startText && endText && startText > endText) {
    throw new Error("The start date must not be after the end date.");
  }
  if (els.operationFilter.value) {
    clauses.push(`emergency_op_name = '${escapeSqlLiteral(els.operationFilter.value)}'`);
  }
  if (els.serviceFilter.value) {
    clauses.push(`source_item_id = '${escapeSqlLiteral(els.serviceFilter.value)}'`);
  }
  if (els.changeTypeFilter.value) {
    clauses.push(`change_type = '${escapeSqlLiteral(els.changeTypeFilter.value)}'`);
  }
  return clauses.join(" AND ");
}

function showState(name, message = "") {
  const isLoading = name === "loading";
  els.workspace.setAttribute("aria-busy", String(isLoading));
  els.signedOutState.hidden = name !== "signedOut";
  els.loadingState.hidden = !isLoading;
  els.errorState.hidden = name !== "error";
  els.emptyState.hidden = name !== "empty";
  els.contentGrid.hidden = name !== "content";
  if (name === "error") els.errorMessage.textContent = message;
}

function setControlsEnabled(enabled) {
  els.refreshButton.disabled = !enabled;
  els.applyFiltersButton.disabled = !enabled;
  els.clearFiltersButton.disabled = !enabled;
}

function setMapMessage(message, kind = "") {
  els.mapMessage.textContent = message;
  els.mapMessage.classList.toggle("is-error", kind === "error");
  els.mapMessage.classList.toggle("is-success", kind === "success");
}

function errorMessage(error) {
  const raw = error?.details?.messages?.[0] || error?.message || String(error || "Unknown error");
  return raw.replace(/token=[^&\s]+/gi, "token=[redacted]");
}

async function initializeSdk() {
  if (!globalThis.$arcgis) throw new Error("ArcGIS Maps SDK 5.1 did not load.");
  [
    OAuthInfo,
    esriId,
    Portal,
    PortalItem,
    WebMap,
    FeatureLayer,
    GraphicsLayer,
    Graphic,
    esriRequest,
    SimpleMarkerSymbol,
    SimpleLineSymbol,
    SimpleFillSymbol
  ] = await $arcgis.import([
    "@arcgis/core/identity/OAuthInfo.js",
    "@arcgis/core/identity/IdentityManager.js",
    "@arcgis/core/portal/Portal.js",
    "@arcgis/core/portal/PortalItem.js",
    "@arcgis/core/WebMap.js",
    "@arcgis/core/layers/FeatureLayer.js",
    "@arcgis/core/layers/GraphicsLayer.js",
    "@arcgis/core/Graphic.js",
    "@arcgis/core/request.js",
    "@arcgis/core/symbols/SimpleMarkerSymbol.js",
    "@arcgis/core/symbols/SimpleLineSymbol.js",
    "@arcgis/core/symbols/SimpleFillSymbol.js"
  ]);

  const isMobile = /Android|iPad|iPhone|iPod/i.test(navigator.userAgent);
  oauthInfo = new OAuthInfo({
    appId: CONFIG.oauthClientId,
    portalUrl: CONFIG.portalUrl,
    popup: !isMobile,
    popupCallbackUrl: CONFIG.oauthPopupCallbackUrl
  });
  esriId.registerOAuthInfos([oauthInfo]);
}

async function initializeMap(portal) {
  if (state.mapInitialized) return;

  await customElements.whenDefined("arcgis-map");
  const webMap = new WebMap({
    portalItem: new PortalItem({ id: CONFIG.webMapItemId, portal })
  });
  await webMap.load();
  els.auditMap.map = webMap;
  await els.auditMap.viewOnReady();

  state.mapGraphics = new GraphicsLayer({ title: "Resolved audit source feature", listMode: "hide" });
  els.auditMap.map.add(state.mapGraphics);
  els.auditMap.view.on("click", async (event) => {
    const hit = await els.auditMap.view.hitTest(event, { include: state.mapGraphics });
    const result = hit.results.find((candidate) => candidate.graphic?.attributes?.event_id);
    if (result) selectRecord(result.graphic.attributes.event_id, { resolveMap: false, scroll: true });
  });
  state.mapInitialized = true;
}

async function checkAuthentication() {
  try {
    await esriId.checkSignInStatus(`${CONFIG.portalUrl}/sharing`);
    await onAuthenticated();
  } catch {
    showSignedOut();
  }
}

function showSignedOut() {
  els.identitySummary.textContent = "Signed out";
  els.signInButton.hidden = false;
  els.signOutButton.hidden = true;
  setControlsEnabled(false);
  showState("signedOut");
}

async function signIn() {
  els.signInButton.loading = true;
  try {
    await esriId.getCredential(`${CONFIG.portalUrl}/sharing`);
    await onAuthenticated();
  } catch (error) {
    if (error?.name !== "identity-manager:user-aborted") showState("error", `Sign-in failed: ${errorMessage(error)}`);
  } finally {
    els.signInButton.loading = false;
  }
}

function signOut() {
  esriId.destroyCredentials();
  window.location.reload();
}

async function onAuthenticated() {
  showState("loading");
  setControlsEnabled(false);
  try {
    const portal = new Portal({ url: CONFIG.portalUrl, authMode: "immediate" });
    await portal.load();
    els.identitySummary.textContent = `${portal.user?.fullName || portal.user?.username || "Authorized user"} · ${portal.name || "Public Safety"}`;
    els.signInButton.hidden = true;
    els.signOutButton.hidden = false;

    await initializeMap(portal);
    await resolveAuditTable(portal);
    await populateFilterOptions();
    setControlsEnabled(true);
    await queryAuditRecords({ reset: true });
  } catch (error) {
    showState("error", `Unable to initialize the audit monitor: ${errorMessage(error)}`);
    setControlsEnabled(false);
  }
}

async function resolveAuditTable(portal) {
  const item = new PortalItem({ id: CONFIG.controlServiceItemId, portal });
  await item.load();
  if (!item.url) throw new Error("The control service item does not expose a service URL.");

  const serviceUrl = item.url.replace(/\/+$/, "");
  const response = await esriRequest(serviceUrl, { query: { f: "json" }, responseType: "json" });
  const tables = response.data?.tables || [];
  const auditTable = tables.find((table) => table.name === CONFIG.auditTableName);
  if (!auditTable) throw new Error(`Table ${CONFIG.auditTableName} was not found in the control service.`);

  state.serviceUrl = serviceUrl;
  state.auditLayer = new FeatureLayer({
    url: `${serviceUrl}/${auditTable.id}`,
    title: CONFIG.auditTableName,
    outFields: ["*"]
  });
  await state.auditLayer.load();
}

async function populateFilterOptions() {
  const [operations, services] = await Promise.all([
    queryDistinct(["emergency_op_name"]),
    queryDistinct(["source_item_id", "service_name"])
  ]);

  replaceOptions(
    els.operationFilter,
    "All operations",
    operations
      .map((feature) => feature.attributes.emergency_op_name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }))
  );

  const serviceMap = new Map();
  for (const feature of services) {
    const { source_item_id: id, service_name: name } = feature.attributes;
    if (id) serviceMap.set(id, name || id);
  }
  replaceOptions(
    els.serviceFilter,
    "All services",
    [...serviceMap].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  );
}

async function queryDistinct(outFields) {
  const query = state.auditLayer.createQuery();
  query.where = "1=1";
  query.outFields = outFields;
  query.returnGeometry = false;
  query.returnDistinctValues = true;
  const result = await state.auditLayer.queryFeatures(query);
  return result.features;
}

function replaceOptions(select, allLabel, options) {
  select.replaceChildren();
  select.add(new Option(allLabel, ""));
  for (const option of options) select.add(new Option(option.label, option.value));
}

async function queryAuditRecords({ reset }) {
  if (!state.auditLayer || state.loading) return;
  state.loading = true;
  els.loadMoreButton.loading = true;
  if (reset) {
    showState("loading");
    state.nextStart = 0;
    state.records = [];
    state.recordByEventId.clear();
    clearSelection();
  }

  try {
    if (!SORT_FIELDS.has(state.sortField)) throw new Error("Unsupported sort field.");
    const query = state.auditLayer.createQuery();
    query.where = buildWhereClause();
    query.outFields = ["*"];
    query.returnGeometry = false;
    query.orderByFields = [`${state.sortField} ${state.sortDirection.toUpperCase()}`, "OBJECTID DESC"];
    query.start = state.nextStart;
    query.num = CONFIG.pageSize;

    const result = await state.auditLayer.queryFeatures(query);
    const incoming = result.features.map((feature) => feature.attributes);
    state.records.push(...incoming);
    for (const record of incoming) state.recordByEventId.set(record.event_id, record);
    state.nextStart += incoming.length;
    state.hasMore = Boolean(result.exceededTransferLimit) || incoming.length === CONFIG.pageSize;

    renderRecords();
    if (state.records.length === 0) showState("empty");
    else showState("content");
  } catch (error) {
    showState("error", `The audit query failed: ${errorMessage(error)}`);
  } finally {
    state.loading = false;
    els.loadMoreButton.loading = false;
  }
}

function renderRecords() {
  els.auditTableBody.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const record of state.records) fragment.append(createAuditRow(record));
  els.auditTableBody.append(fragment);

  const adds = state.records.filter((record) => record.change_type === "ADD").length;
  const deletes = state.records.filter((record) => record.change_type === "DELETE").length;
  const updates = state.records.length - adds - deletes;
  els.kpiTotal.textContent = state.records.length.toLocaleString();
  els.kpiAdds.textContent = adds.toLocaleString();
  els.kpiUpdates.textContent = updates.toLocaleString();
  els.kpiDeletes.textContent = deletes.toLocaleString();
  els.resultSummary.textContent = `${state.records.length.toLocaleString()} loaded`;
  els.loadMoreButton.hidden = !state.hasMore;
  els.truncationNote.textContent = state.hasMore
    ? `Showing the first ${state.records.length.toLocaleString()} matching rows. Load more to continue.`
    : "All rows returned for the current query are loaded.";
  updateSortIndicators();
}

function createAuditRow(record) {
  const row = document.createElement("tr");
  row.className = "audit-row";
  row.tabIndex = 0;
  row.dataset.eventId = record.event_id;
  row.setAttribute("aria-selected", String(record.event_id === state.selectedEventId));
  row.setAttribute("aria-label", `${displayValue(record.change_type)} event for ${displayValue(record.layer_name)}`);

  row.append(
    tableCell(formatDate(record.event_timestamp), displayValue(record.event_id)),
    tableCell(displayValue(record.emergency_op_name, "Unassigned operation"), displayValue(record.batch_id)),
    tableCell(displayValue(record.service_name), `${displayValue(record.layer_name)} · layer ${displayValue(record.layer_id)}`),
    badgeCell(record.change_type),
    tableCell(displayValue(record.authenticated_user, "Unknown"), displayValue(record.identity_resolution)),
    mapStatusCell(record)
  );

  const activate = () => selectRecord(record.event_id, { resolveMap: true, scroll: false });
  row.addEventListener("click", activate);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
  return row;
}

function tableCell(primary, secondary) {
  const cell = document.createElement("td");
  const first = document.createElement("span");
  first.className = "cell-primary";
  first.textContent = primary;
  const second = document.createElement("span");
  second.className = "cell-secondary";
  second.textContent = secondary;
  cell.append(first, second);
  return cell;
}

function badgeCell(changeType) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `change-badge ${changeType === "ADD" ? "change-add" : changeType === "DELETE" ? "change-delete" : "change-update"}`;
  badge.textContent = displayValue(changeType).replaceAll("_", " ");
  cell.append(badge);
  return cell;
}

function mapStatusCell(record) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");
  const isDelete = record.change_type === "DELETE";
  badge.className = `map-badge ${isDelete ? "map-unavailable" : "map-available"}`;
  badge.textContent = isDelete ? "Not mappable" : "Resolve";
  badge.title = isDelete
    ? "Delete events have no stored geometry in the audit table."
    : "Queries the current source layer by feature GlobalID.";
  cell.append(badge);
  return cell;
}

function updateSortIndicators() {
  document.querySelectorAll(".sort-button").forEach((button) => {
    const active = button.dataset.sort === state.sortField;
    button.closest("th").setAttribute("aria-sort", active ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none");
    button.querySelector("span").textContent = active ? (state.sortDirection === "asc" ? "▲" : "▼") : "";
  });
}

function clearSelection() {
  state.selectedEventId = null;
  state.mapGraphics?.removeAll();
  els.detailEmpty.hidden = false;
  els.detailList.hidden = true;
  els.changedFieldsSection.hidden = true;
  setMapMessage("Select a non-delete event to resolve its current source feature.");
}

async function selectRecord(eventId, { resolveMap, scroll }) {
  const record = state.recordByEventId.get(eventId);
  if (!record) return;
  state.selectedEventId = eventId;
  document.querySelectorAll(".audit-row").forEach((row) => {
    const selected = row.dataset.eventId === eventId;
    row.setAttribute("aria-selected", String(selected));
    if (selected && scroll) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  renderDetails(record);
  if (resolveMap) await resolveSourceFeature(record);
}

function renderDetails(record) {
  const details = [
    ["Event time", formatDate(record.event_timestamp)],
    ["Recorded", formatDate(record.recorded_utc)],
    ["Operation", displayValue(record.emergency_op_name, "Unassigned")],
    ["Change type", displayValue(record.change_type)],
    ["Editor", displayValue(record.authenticated_user, "Unknown")],
    ["Identity method", displayValue(record.identity_resolution)],
    ["Service", displayValue(record.service_name)],
    ["Layer", `${displayValue(record.layer_name)} (${displayValue(record.layer_id)})`],
    ["Source item", displayValue(record.source_item_id)],
    ["Feature GlobalID", displayValue(record.feature_globalid)],
    ["Workflow job", displayValue(record.wfm_job_id)],
    ["Batch", displayValue(record.batch_id)],
    ["Geometry changed", displayValue(record.geometry_changed)]
  ];
  els.detailList.replaceChildren();
  for (const [term, value] of details) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    els.detailList.append(dt, dd);
  }
  els.detailEmpty.hidden = true;
  els.detailList.hidden = false;

  const changed = parseChangedFields(record.changed_fields_json);
  els.changedFields.textContent = changed;
  els.changedFieldsSection.hidden = false;
}

function parseChangedFields(value) {
  if (!value) return "No field-level changes recorded.";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return String(value);
  }
}

async function resolveSourceFeature(record) {
  state.mapGraphics.removeAll();
  if (record.change_type === "DELETE") {
    setMapMessage("Delete event: not mappable. The audit table is nonspatial and no historical geometry is stored. Add a governed geometry snapshot in a future schema to map deletes.", "error");
    return;
  }

  setMapMessage("Resolving the current source feature by GlobalID…");
  try {
    const layer = await getSourceLayer(record);
    if (!layer.geometryType) {
      setMapMessage("The resolved source is nonspatial, so this event cannot be displayed on the map.", "error");
      return;
    }
    const globalIdField = layer.globalIdField || layer.fields.find((field) => field.type === "global-id")?.name;
    if (!globalIdField || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(globalIdField)) {
      throw new Error("The source layer does not expose a safe GlobalID field.");
    }

    const query = layer.createQuery();
    query.where = `${globalIdField} = '${escapeSqlLiteral(record.feature_globalid)}'`;
    query.outFields = ["*"];
    query.returnGeometry = true;
    query.num = 1;
    const result = await layer.queryFeatures(query);
    const feature = result.features[0];
    if (!feature?.geometry) {
      setMapMessage("No current source geometry was found. The feature may have been deleted after this non-delete event, or access may be restricted.", "error");
      return;
    }

    const graphic = new Graphic({
      geometry: feature.geometry,
      attributes: { event_id: record.event_id },
      symbol: selectionSymbol(feature.geometry.type)
    });
    state.mapGraphics.add(graphic);
    await els.auditMap.view.goTo(feature.geometry.extent?.expand(1.8) || feature.geometry, { duration: 550 });
    setMapMessage(`Mapped the current source feature from ${record.layer_name}. Geometry represents its present state, not necessarily its event-time state.`, "success");
  } catch (error) {
    setMapMessage(`Source feature could not be mapped: ${errorMessage(error)}`, "error");
  }
}

async function getSourceLayer(record) {
  const baseUrl = String(record.service_url || "").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(baseUrl)) throw new Error("The audit row has no valid HTTPS source service URL.");
  const layerId = Number(record.layer_id);
  if (!Number.isInteger(layerId) || layerId < 0) throw new Error("The audit row has an invalid source layer ID.");
  const url = `${baseUrl}/${layerId}`;
  if (!state.sourceLayers.has(url)) {
    const layer = new FeatureLayer({ url, outFields: ["*"] });
    await layer.load();
    state.sourceLayers.set(url, layer);
  }
  return state.sourceLayers.get(url);
}

function selectionSymbol(geometryType) {
  if (geometryType === "point" || geometryType === "multipoint") {
    return new SimpleMarkerSymbol({
      color: [242, 169, 0, 0.28],
      size: 18,
      outline: { color: [139, 211, 255, 1], width: 2.5 }
    });
  }
  if (geometryType === "polyline") {
    return new SimpleLineSymbol({ color: [139, 211, 255, 1], width: 4 });
  }
  return new SimpleFillSymbol({
    color: [242, 169, 0, 0.18],
    outline: { color: [139, 211, 255, 1], width: 2.5 }
  });
}

function resetFilters() {
  setDefaultDates();
  els.operationFilter.value = "";
  els.serviceFilter.value = "";
  els.changeTypeFilter.value = "";
  queryAuditRecords({ reset: true });
}

function wireEvents() {
  els.signInButton.addEventListener("click", signIn);
  els.signOutButton.addEventListener("click", signOut);
  els.refreshButton.addEventListener("click", () => queryAuditRecords({ reset: true }));
  els.filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    queryAuditRecords({ reset: true });
  });
  els.clearFiltersButton.addEventListener("click", resetFilters);
  els.loadMoreButton.addEventListener("click", () => queryAuditRecords({ reset: false }));
  document.querySelectorAll(".sort-button").forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.dataset.sort;
      if (!SORT_FIELDS.has(field)) return;
      if (state.sortField === field) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      else {
        state.sortField = field;
        state.sortDirection = field === "event_timestamp" ? "desc" : "asc";
      }
      queryAuditRecords({ reset: true });
    });
  });
}

async function main() {
  setDefaultDates();
  wireEvents();
  showState("loading");
  try {
    await initializeSdk();
    await checkAuthentication();
  } catch (error) {
    els.fatalError.textContent = `Application initialization failed: ${errorMessage(error)}`;
    els.fatalError.hidden = false;
    showState("error", errorMessage(error));
  }
}

main();
