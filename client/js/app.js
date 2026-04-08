import { fetchFountainsByNil, fetchHealth, fetchNilStats } from "./api.js";
import { fitToMilan, initMap, renderFountainsOnMap } from "./map.js";

const nilSearchForm = document.getElementById("nil-search-form");
const nilInput = document.getElementById("nil-input");
const loadStatsBtn = document.getElementById("load-stats-btn");
const resetMapBtn = document.getElementById("reset-map-btn");
const feedbackEl = document.getElementById("api-feedback");
const resultsListEl = document.getElementById("results-list");
const statsTableBody = document.querySelector("#stats-table tbody");

let mapContext = null;

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

async function bootstrap() {
  mapContext = initMap("map");
  fitToMilan(mapContext);

  try {
    const data = await fetchHealth();
    setFeedback(`API connessa: ${data.service}.`, "ok");
  } catch (error) {
    setFeedback(`Errore API: ${error.message}`, "error");
  }
}

async function handleNilSearch(event) {
  event.preventDefault();
  const nil = nilInput.value.trim();

  if (!nil) {
    setFeedback("Inserisci un NIL valido.", "warn");
    return;
  }

  setFeedback(`Ricerca fontanelle per NIL ${nil}...`, "pending");

  try {
    const items = await fetchFountainsByNil(nil);
    renderResultsList(items);
    renderFountainsOnMap(mapContext, items);
    setFeedback(`Trovate ${items.length} fontanelle nel NIL ${nil}.`, "ok");
  } catch (error) {
    renderResultsList([]);
    setFeedback(`Errore ricerca NIL: ${error.message}`, "error");
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
  nilInput.value = "";
  renderResultsList([]);
  renderStatsTable([]);
  fitToMilan(mapContext);
  renderFountainsOnMap(mapContext, []);
  setFeedback("Interfaccia resettata.", "pending");
}

nilSearchForm.addEventListener("submit", handleNilSearch);
loadStatsBtn.addEventListener("click", handleLoadStats);
resetMapBtn.addEventListener("click", handleReset);

document.addEventListener("DOMContentLoaded", bootstrap);
