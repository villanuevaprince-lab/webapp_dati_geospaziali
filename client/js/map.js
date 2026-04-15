const MILAN_CENTER = [45.4642, 9.19];
const MILAN_ZOOM = 12;

const TILE_PROVIDERS = {
  cartoLight: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    options: {
      subdomains: "abcd",
      maxZoom: 20,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
};

function createNearbySearchHandleIcon() {
  return L.divIcon({
    className: "nearby-search-handle-icon",
    html: "<span></span>",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function notifyNearbySearchHandlePosition(mapContext) {
  if (!mapContext?.nearbySearchHandleMarker || typeof mapContext.onNearbySearchHandleMove !== "function") {
    return;
  }

  const latLng = mapContext.nearbySearchHandleMarker.getLatLng();
  mapContext.onNearbySearchHandleMove({
    lat: Number(latLng.lat),
    lng: Number(latLng.lng),
  });
}

function getCount(feature) {
  return Number(feature?.properties?.fontanelle_count) || 0;
}

function getColorByCount(count, maxCount) {
  if (!Number.isFinite(count) || count <= 0 || maxCount <= 0) {
    return "#f1f7ff";
  }

  const ratio = Math.min(1, count / maxCount);
  if (ratio > 0.8) return "#08306b";
  if (ratio > 0.6) return "#08519c";
  if (ratio > 0.4) return "#2171b5";
  if (ratio > 0.2) return "#4292c6";
  return "#6baed6";
}

function createLegendControl(maxCount) {
  const legend = L.control({ position: "bottomright" });

  legend.onAdd = function onAdd() {
    const div = L.DomUtil.create("div", "nil-choropleth-legend");
    const stops = [0, 0.2, 0.4, 0.6, 0.8, 1];

    div.innerHTML = '<h4>Fontanelle per NIL</h4>';
    stops.forEach((stop, index) => {
      const count = Math.round(stop * maxCount);
      const next = index < stops.length - 1 ? Math.round(stops[index + 1] * maxCount) : null;
      const color = getColorByCount(count, maxCount);
      const label = next === null ? `${count}+` : `${count} - ${Math.max(count, next - 1)}`;
      div.innerHTML += `<div><i style="background:${color}"></i>${label}</div>`;
    });

    return div;
  };

  return legend;
}

function extractLatLng(item) {
  const geometry = item.geometry || item.coordinate || item.coordinates;
  const coords = geometry?.coordinates;

  if (!Array.isArray(coords) || coords.length !== 2) {
    return null;
  }

  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  return [lat, lng];
}

export function initMap(containerId) {
  const map = L.map(containerId, {
    zoomControl: true,
  }).setView(MILAN_CENTER, MILAN_ZOOM);

  const primaryTileLayer = L.tileLayer(
    TILE_PROVIDERS.cartoLight.url,
    TILE_PROVIDERS.cartoLight.options,
  ).addTo(map);

  let fallbackAttached = false;
  primaryTileLayer.on("tileerror", () => {
    if (fallbackAttached) {
      return;
    }
    fallbackAttached = true;
    map.removeLayer(primaryTileLayer);
    L.tileLayer(TILE_PROVIDERS.osm.url, TILE_PROVIDERS.osm.options).addTo(map);
    console.warn("Tile provider principale non disponibile, fallback su OpenStreetMap.");
  });

  const markersLayer = L.layerGroup().addTo(map);
  const referenceLayer = L.layerGroup().addTo(map);
  const searchHandleLayer = L.layerGroup().addTo(map);
  return {
    map,
    markersLayer,
    referenceLayer,
    searchHandleLayer,
    choroplethLayer: null,
    choroplethLegend: null,
    selectedNilLayer: null,
    nearbySearchHandleMarker: null,
    onNearbySearchHandleMove: null,
  };
}

export function setupNearbySearchHandle(mapContext, { lat, lng, onPositionChange } = {}) {
  if (!mapContext?.map || !mapContext?.searchHandleLayer) {
    return null;
  }

  if (typeof onPositionChange === "function") {
    mapContext.onNearbySearchHandleMove = onPositionChange;
  }

  if (!mapContext.nearbySearchHandleMarker) {
    const initialLat = Number.isFinite(Number(lat)) ? Number(lat) : MILAN_CENTER[0];
    const initialLng = Number.isFinite(Number(lng)) ? Number(lng) : MILAN_CENTER[1];

    const marker = L.marker([initialLat, initialLng], {
      draggable: true,
      title: "Punto di ricerca entro 500 m",
      icon: createNearbySearchHandleIcon(),
      zIndexOffset: 1200,
    });

    marker.on("dragend", () => {
      notifyNearbySearchHandlePosition(mapContext);
    });

    mapContext.searchHandleLayer.addLayer(marker);
    mapContext.nearbySearchHandleMarker = marker;
  }

  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    mapContext.nearbySearchHandleMarker.setLatLng([Number(lat), Number(lng)]);
  }

  notifyNearbySearchHandlePosition(mapContext);
  return mapContext.nearbySearchHandleMarker;
}

export function getNearbySearchHandlePosition(mapContext) {
  if (!mapContext?.nearbySearchHandleMarker) {
    return null;
  }

  const latLng = mapContext.nearbySearchHandleMarker.getLatLng();
  return {
    lat: Number(latLng.lat),
    lng: Number(latLng.lng),
  };
}

export function setNearbySearchHandlePosition(mapContext, { lat, lng, panTo = false }) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return;
  }

  const marker = setupNearbySearchHandle(mapContext, { lat: Number(lat), lng: Number(lng) });
  if (!marker) {
    return;
  }

  marker.setLatLng([Number(lat), Number(lng)]);
  notifyNearbySearchHandlePosition(mapContext);

  if (panTo && mapContext?.map) {
    mapContext.map.panTo([Number(lat), Number(lng)]);
  }
}

export function fitToMilan(mapContext) {
  if (!mapContext?.map) {
    return;
  }
  clearReferenceArea(mapContext);
  mapContext.map.setView(MILAN_CENTER, MILAN_ZOOM);
}

export function renderFountainsOnMap(mapContext, fountains, { fit = true } = {}) {
  if (!mapContext?.map || !mapContext?.markersLayer) {
    return;
  }

  const { map, markersLayer } = mapContext;
  markersLayer.clearLayers();

  const bounds = [];
  fountains.forEach((item) => {
    const latLng = extractLatLng(item);
    if (!latLng) {
      return;
    }

    const props = item.properties || {};
    const label = item.nome || (props.objectID ? `Fontanella ${props.objectID}` : "Fontanella");
    const nilName = item.nil || props.NIL || "n/d";
    const municipio = props.MUNICIPIO ? `Municipio ${props.MUNICIPIO}` : "Municipio n/d";
    const cap = props.CAP || "CAP n/d";

    bounds.push(latLng);

    const marker = L.marker(latLng);
    const popup = `
      <strong>${label}</strong><br>
      NIL: ${nilName}<br>
      ${municipio} - ${cap}
    `;
    marker.bindPopup(popup);
    markersLayer.addLayer(marker);
  });

  if (!fit) {
    return;
  }

  if (bounds.length === 1) {
    map.setView(bounds[0], 15);
    return;
  }

  if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [32, 32] });
  }
}

export function clearChoroplethLayer(mapContext) {
  if (!mapContext?.map) {
    return;
  }

  if (mapContext.choroplethLayer) {
    mapContext.map.removeLayer(mapContext.choroplethLayer);
    mapContext.choroplethLayer = null;
  }

  if (mapContext.choroplethLegend) {
    mapContext.map.removeControl(mapContext.choroplethLegend);
    mapContext.choroplethLegend = null;
  }
}

export function clearSelectedNilLayer(mapContext) {
  if (!mapContext?.map || !mapContext.selectedNilLayer) {
    return;
  }

  mapContext.map.removeLayer(mapContext.selectedNilLayer);
  mapContext.selectedNilLayer = null;
}

export function renderNilChoropleth(mapContext, geojson) {
  if (!mapContext?.map) {
    return;
  }

  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  clearChoroplethLayer(mapContext);
  clearSelectedNilLayer(mapContext);
  clearReferenceArea(mapContext);

  if (mapContext.markersLayer) {
    mapContext.markersLayer.clearLayers();
  }

  if (!features.length) {
    return;
  }

  const maxCount = Math.max(...features.map((feature) => getCount(feature)), 0);

  const choroplethLayer = L.geoJSON(geojson, {
    style: (feature) => {
      const count = getCount(feature);
      return {
        fillColor: getColorByCount(count, maxCount),
        weight: 1.3,
        opacity: 1,
        color: "#27496d",
        fillOpacity: 0.78,
      };
    },
    onEachFeature: (feature, layer) => {
      const nilName = feature?.properties?.nil || feature?.properties?.NIL || "NIL non specificato";
      const count = getCount(feature);

      layer.bindPopup(`<strong>${nilName}</strong><br>Fontanelle: ${count}`);

      layer.on({
        mouseover: (event) => {
          const targetLayer = event.target;
          targetLayer.setStyle({
            weight: 2.2,
            color: "#0b2545",
            fillOpacity: 0.9,
          });
          targetLayer.bringToFront();
        },
        mouseout: () => {
          choroplethLayer.resetStyle(layer);
        },
      });
    },
  }).addTo(mapContext.map);

  mapContext.choroplethLayer = choroplethLayer;

  const legend = createLegendControl(maxCount);
  legend.addTo(mapContext.map);
  mapContext.choroplethLegend = legend;

  const bounds = choroplethLayer.getBounds();
  if (bounds?.isValid?.()) {
    mapContext.map.fitBounds(bounds, { padding: [20, 20] });
  }
}

export function renderSelectedNilFeature(mapContext, geojson) {
  if (!mapContext?.map) {
    return false;
  }

  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  clearChoroplethLayer(mapContext);
  clearSelectedNilLayer(mapContext);
  clearReferenceArea(mapContext);

  if (!features.length) {
    return false;
  }

  const maxCount = Math.max(...features.map((feature) => getCount(feature)), 0);
  const selectedNilLayer = L.geoJSON(geojson, {
    style: (feature) => {
      const count = getCount(feature);
      return {
        fillColor: getColorByCount(count, Math.max(maxCount, 1)),
        weight: 2.2,
        opacity: 1,
        color: "#1e3a8a",
        fillOpacity: 0.42,
      };
    },
    onEachFeature: (feature, layer) => {
      const nilName = feature?.properties?.nil || feature?.properties?.NIL || "NIL non specificato";
      const count = getCount(feature);
      layer.bindPopup(`<strong>${nilName}</strong><br>Fontanelle: ${count}`);
    },
  }).addTo(mapContext.map);

  mapContext.selectedNilLayer = selectedNilLayer;

  const bounds = selectedNilLayer.getBounds();
  if (bounds?.isValid?.()) {
    mapContext.map.fitBounds(bounds, { padding: [24, 24] });
  }

  return true;
}

export function clearReferenceArea(mapContext) {
  if (!mapContext?.referenceLayer) {
    return;
  }
  mapContext.referenceLayer.clearLayers();
}

function fitToAllLayers(mapContext) {
  const { map, markersLayer, referenceLayer, searchHandleLayer } = mapContext;
  const bounds = [];

  const collectBounds = (layerGroup) => {
    layerGroup.eachLayer((layer) => {
      if (typeof layer.getBounds === "function") {
        const layerBounds = layer.getBounds();
        if (layerBounds?.isValid?.()) {
          bounds.push(layerBounds.getNorthEast(), layerBounds.getSouthWest());
        }
        return;
      }

      if (typeof layer.getLatLng === "function") {
        bounds.push(layer.getLatLng());
      }
    });
  };

  collectBounds(markersLayer);
  collectBounds(referenceLayer);
  collectBounds(searchHandleLayer);

  if (!bounds.length) {
    return;
  }

  if (bounds.length === 1) {
    map.setView(bounds[0], 15);
    return;
  }

  map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32] });
}

export function renderReferenceArea(mapContext, { lat, lng, radiusMeters = 500 }) {
  if (!mapContext?.map || !mapContext?.referenceLayer) {
    return;
  }

  const { referenceLayer } = mapContext;
  referenceLayer.clearLayers();

  const refLatLng = [Number(lat), Number(lng)];

  const circle = L.circle(refLatLng, {
    radius: Number(radiusMeters),
    color: "#0d6e6e",
    fillColor: "#0d6e6e",
    fillOpacity: 0.12,
    weight: 2,
  });
  referenceLayer.addLayer(circle);

  fitToAllLayers(mapContext);
}
