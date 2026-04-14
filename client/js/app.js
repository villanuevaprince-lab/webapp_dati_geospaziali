import { fetchFountainsByNil, fetchFountainsNearby, fetchHealth, fetchNilList, fetchNilStats } from "./api.js";
import { clearReferenceArea, fitToMilan, initMap, renderFountainsOnMap, renderReferenceArea } from "./map.js";

const nilSearchForm = document.getElementById("nil-search-form");
const nearbySearchForm = document.getElementById("nearby-search-form");
const nilSelect = document.getElementById("nil-select");
const latInput = document.getElementById("lat-input");
const lngInput = document.getElementById("lng-input");
const loadStatsBtn = document.getElementById("load-stats-btn");
const resetMapBtn = document.getElementById("reset-map-btn");
const feedbackEl = document.getElementById("api-feedback");
const resultsListEl = document.getElementById("results-list");
const resultsCountEl = document.getElementById("results-count");
const statsTableBody = document.querySelector("#stats-table tbody");

let mapContext = null;
const DEFAULT_NEARBY_RADIUS = 500;

function setFeedback(message, tone = "pending") {
  feedbackEl.textContent = message;
  feedbackEl.className = `status ${tone}`;
}

function renderResultsList(items) {
  resultsListEl.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("li");
    empty.textContent = "Nessun risultato disponibile.";
    resultsListEl.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const props = item.properties || {};
    const label = item.nome || (props.objectID ? `Fontanella ${props.objectID}` : "Fontanella senza nome");
    const nilName = item.nil || props.NIL || "n/d";
    const municipio = props.MUNICIPIO ? `Municipio ${props.MUNICIPIO}` : "Municipio n/d";
    const cap = props.CAP || "CAP n/d";

    const li = document.createElement("li");
    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = label;

    const subtitle = document.createElement("div");
    subtitle.className = "item-subtitle";
    subtitle.textContent = `${municipio} - ${cap} - NIL ${nilName}`;

    li.appendChild(title);
    li.appendChild(subtitle);
    resultsListEl.appendChild(li);
  });
}

function setResultsCount(count) {
  resultsCountEl.textContent = `Risultati: ${count}`;
}

function parseCoordinate(valueRaw, fieldName, min, max) {
  const value = Number(valueRaw);

  if (!Number.isFinite(value)) {
    throw new Error(`Parametro ${fieldName} non valido.`);
  }

  if (value < min || value > max) {
    throw new Error(`Parametro ${fieldName} fuori intervallo.`);
  }

  return value;
}

function renderStatsTable(items) {
  statsTableBody.innerHTML = "";

  if (!items.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="2">Nessuna statistica disponibile.</td>';
    statsTableBody.appendChild(row);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("tr");
    const nilCell = document.createElement("td");
    nilCell.textContent = item.nil || "Sconosciuto";
    const countCell = document.createElement("td");
    countCell.textContent = item.count ?? 0;
    row.appendChild(nilCell);
    row.appendChild(countCell);
    statsTableBody.appendChild(row);
  });
}

function renderNilOptions(items) {
  nilSelect.innerHTML = "";

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = "Seleziona un NIL...";
  nilSelect.appendChild(placeholderOption);

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    nilSelect.appendChild(option);
  });
}

async function loadNilDropdown() {
  try {
    const nilItems = await fetchNilList();
    renderNilOptions(nilItems);
  } catch (error) {
    renderNilOptions([]);
    setFeedback(`Errore caricamento NIL: ${error.message}`, "error");
  }
}

async function bootstrap() {
  mapContext = initMap("map");
  fitToMilan(mapContext);

  try {
    const data = await fetchHealth();
    setFeedback(`API connessa: ${data.service}.`, "ok");
  } catch (error) {
    setFeedback(`Errore API: ${error.message}`, "error");
  }

  await loadNilDropdown();
}

async function handleNilSearch(event) {
  event.preventDefault();
  const nil = nilSelect.value.trim();

  if (!nil) {
    setFeedback("Seleziona un NIL valido.", "warn");
    return;
  }

  setFeedback(`Ricerca fontanelle per NIL ${nil}...`, "pending");

  try {
    const items = await fetchFountainsByNil(nil);
    renderResultsList(items);
    clearReferenceArea(mapContext);
    renderFountainsOnMap(mapContext, items);
    setResultsCount(items.length);

    if (!items.length) {
      fitToMilan(mapContext);
      setFeedback(`Nessuna fontanella trovata per il NIL ${nil}.`, "warn");
      return;
    }

    setFeedback(`Trovate ${items.length} fontanelle nel NIL ${nil}.`, "ok");
  } catch (error) {
    renderResultsList([]);
    setResultsCount(0);
    renderFountainsOnMap(mapContext, []);
    setFeedback(`Errore ricerca NIL: ${error.message}`, "error");
  }
}

async function handleNearbySearch(event) {
  event.preventDefault();

  try {
    const lat = parseCoordinate(latInput.value.trim(), "lat", -90, 90);
    const lng = parseCoordinate(lngInput.value.trim(), "lng", -180, 180);

    setFeedback("Ricerca fontanelle entro 500 m in corso...", "pending");

    const data = await fetchFountainsNearby({
      lng,
      lat,
      radius: DEFAULT_NEARBY_RADIUS,
    });

    const items = Array.isArray(data.items) ? data.items : [];
    renderResultsList(items);
    renderFountainsOnMap(mapContext, items);
    renderReferenceArea(mapContext, {
      lat,
      lng,
      radiusMeters: DEFAULT_NEARBY_RADIUS,
    });
    setResultsCount(items.length);

    if (!items.length) {
      setFeedback("Nessuna fontanella trovata entro 500 m dal punto inserito.", "warn");
      return;
    }

    setFeedback(`Trovate ${items.length} fontanelle entro 500 m dal punto inserito.`, "ok");
  } catch (error) {
    setFeedback(error.message || "Errore durante la ricerca per coordinate.", "error");
  }
}

async function handleLoadStats() {
  setFeedback("Caricamento statistiche NIL...", "pending");

  try {
    const items = await fetchNilStats();
    renderStatsTable(items);
    setFeedback(`Statistiche NIL caricate (${items.length} righe).`, "ok");
  } catch (error) {
    renderStatsTable([]);
    setFeedback(`Errore caricamento statistiche: ${error.message}`, "error");
  }
}

function handleReset() {
  nilSelect.value = "";
  latInput.value = "";
  lngInput.value = "";
  renderResultsList([]);
  setResultsCount(0);
  renderStatsTable([]);
  clearReferenceArea(mapContext);
  renderFountainsOnMap(mapContext, []);
  fitToMilan(mapContext);
  setFeedback("Interfaccia resettata.", "pending");
}

nilSearchForm.addEventListener("submit", handleNilSearch);
nearbySearchForm.addEventListener("submit", handleNearbySearch);
loadStatsBtn.addEventListener("click", handleLoadStats);
resetMapBtn.addEventListener("click", handleReset);

document.addEventListener("DOMContentLoaded", bootstrap);
