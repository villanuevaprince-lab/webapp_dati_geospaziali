import { fetchFountainsByNil, fetchFountainsNearby, fetchHealth, fetchNilList, fetchNilStats } from "./api.js";
import { clearReferenceArea, fitToMilan, initMap, renderFountainsOnMap, renderReferenceArea } from "./map.js";

const nilTextSearchForm = document.getElementById("nil-text-search-form");
const nilSelectSearchForm = document.getElementById("nil-select-search-form");
const nearbySearchForm = document.getElementById("nearby-search-form");
const nilInput = document.getElementById("nil-input");
const nilSelect = document.getElementById("nil-select");
const latInput = document.getElementById("lat-input");
const lngInput = document.getElementById("lng-input");
const nearMeBtn = document.getElementById("near-me-btn");
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

function renderStatsTable(items) {
  statsTableBody.innerHTML = "";

  if (!items.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="2">Nessuna statistica disponibile.</td>';
    statsTableBody.appendChild(row);
    return;
  }

  const maxCount = Math.max(...items.map((item) => Number(item.count) || 0));

  items.forEach((item) => {
    const row = document.createElement("tr");
    const nilCell = document.createElement("td");
    nilCell.textContent = item.nil || "Non specificato";
    const countCell = document.createElement("td");
    countCell.textContent = item.count ?? 0;
    row.appendChild(nilCell);
    row.appendChild(countCell);

    if ((Number(item.count) || 0) === maxCount && maxCount > 0) {
      row.style.backgroundColor = "#f3fbfb";
      row.style.fontWeight = "700";
    }

    statsTableBody.appendChild(row);
  });
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
  await handleLoadStats();
}

async function handleLoadStats() {
  setFeedback("Caricamento statistiche NIL in corso...", "pending");

  statsTableBody.innerHTML = '<tr><td colspan="2">Caricamento statistiche...</td></tr>';

  try {
    const items = await fetchNilStats();
    renderStatsTable(items);
    setFeedback(`Statistiche NIL caricate: ${items.length} righe.`, "ok");
  } catch (error) {
    renderStatsTable([]);
    setFeedback(`Errore caricamento statistiche NIL: ${error.message}`, "error");
  }
}

async function runNilSearch(nil, sourceLabel) {
  setFeedback(`Ricerca fontanelle per NIL ${nil}...`, "pending");

  try {
    const items = await fetchFountainsByNil(nil);
    renderResultsList(items);
    renderFountainsOnMap(mapContext, items);
    setResultsCount(items.length);

    if (!items.length) {
      fitToMilan(mapContext);
      setFeedback(`Nessuna fontanella trovata per il NIL ${nil}.`, "warn");
      return;
    }

    setFeedback(`Trovate ${items.length} fontanelle nel NIL ${nil} (${sourceLabel}).`, "ok");
  } catch (error) {
    renderResultsList([]);
    setResultsCount(0);
    renderFountainsOnMap(mapContext, []);
    fitToMilan(mapContext);
    setFeedback(`Errore ricerca NIL: ${error.message}`, "error");
  }
}

async function handleNilTextSearch(event) {
  event.preventDefault();
  const nil = nilInput.value.trim();

  if (!nil) {
    setFeedback("Inserisci un NIL valido nel campo testo.", "warn");
    return;
  }

  await runNilSearch(nil, "da testo");
}

async function handleNilSelectSearch(event) {
  event.preventDefault();
  const nil = nilSelect.value.trim();

  if (!nil) {
    setFeedback("Seleziona un NIL valido dalla dropdown.", "warn");
    return;
  }

  await runNilSearch(nil, "da dropdown");
}

async function handleNearbySearch(event) {
  event.preventDefault();

  const latRaw = latInput.value.trim();
  const lngRaw = lngInput.value.trim();

  if (!latRaw || !lngRaw) {
    setFeedback("Inserisci sia latitudine sia longitudine.", "warn");
    return;
  }

  try {
    const lat = parseCoordinate(latRaw, "lat", -90, 90);
    const lng = parseCoordinate(lngRaw, "lng", -180, 180);

    await runNearbySearch({ lat, lng, sourceLabel: "dal punto inserito" });
  } catch (error) {
    setFeedback(error.message || "Errore durante la ricerca per coordinate.", "error");
  }
}

async function runNearbySearch({ lat, lng, sourceLabel }) {
  setFeedback("Ricerca fontanelle entro 500 m in corso...", "pending");

  const data = await fetchFountainsNearby({
    lng,
    lat,
    radius: DEFAULT_NEARBY_RADIUS,
  });

  const items = Array.isArray(data.items) ? data.items : [];
  const reference = data.reference_point || { lat, lng };
  const radiusUsed = Number(data.radius_meters) || DEFAULT_NEARBY_RADIUS;

  latInput.value = Number(reference.lat).toFixed(6);
  lngInput.value = Number(reference.lng).toFixed(6);

  renderResultsList(items);
  setResultsCount(items.length);
  renderFountainsOnMap(mapContext, items);
  renderReferenceArea(mapContext, {
    lat: reference.lat,
    lng: reference.lng,
    radiusMeters: radiusUsed,
  });

  if (!items.length) {
    setFeedback(`Nessuna fontanella trovata entro ${radiusUsed} m ${sourceLabel}.`, "warn");
    return;
  }

  setFeedback(`Trovate ${items.length} fontanelle entro ${radiusUsed} m ${sourceLabel}.`, "ok");
}

function geolocationErrorToMessage(error) {
  if (!error || typeof error.code !== "number") {
    return "Impossibile ottenere la posizione corrente.";
  }

  switch (error.code) {
    case 1:
      return "Permesso di geolocalizzazione negato. Abilita la posizione nel browser e riprova.";
    case 2:
      return "Posizione non disponibile al momento. Riprova tra qualche secondo.";
    case 3:
      return "Timeout della geolocalizzazione. Verifica la connessione e riprova.";
    default:
      return "Errore durante la geolocalizzazione dell'utente.";
  }
}

function getCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function handleNearMeSearch() {
  if (!navigator.geolocation) {
    setFeedback("Geolocalizzazione non supportata da questo browser.", "error");
    return;
  }

  setFeedback("Acquisizione posizione corrente in corso...", "pending");

  try {
    const position = await getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });

    const lat = parseCoordinate(position.coords.latitude, "lat", -90, 90);
    const lng = parseCoordinate(position.coords.longitude, "lng", -180, 180);

    await runNearbySearch({ lat, lng, sourceLabel: "dalla tua posizione" });
  } catch (error) {
    const message = error instanceof Error ? error.message : geolocationErrorToMessage(error);
    const fallbackMessage = message || geolocationErrorToMessage(error);
    setFeedback(fallbackMessage, "error");
  }
}

function handleReset() {
  nilInput.value = "";
  nilSelect.value = "";
  latInput.value = "";
  lngInput.value = "";
  renderResultsList([]);
  setResultsCount(0);
  statsTableBody.innerHTML = '<tr><td colspan="2">Premi "Carica statistiche NIL" per visualizzare i dati.</td></tr>';
  clearReferenceArea(mapContext);
  renderFountainsOnMap(mapContext, []);
  fitToMilan(mapContext);
  setFeedback("Interfaccia resettata.", "pending");
}

nilTextSearchForm.addEventListener("submit", handleNilTextSearch);
nilSelectSearchForm.addEventListener("submit", handleNilSelectSearch);
nearbySearchForm.addEventListener("submit", handleNearbySearch);
nearMeBtn.addEventListener("click", handleNearMeSearch);
loadStatsBtn.addEventListener("click", handleLoadStats);
resetMapBtn.addEventListener("click", handleReset);

document.addEventListener("DOMContentLoaded", bootstrap);
