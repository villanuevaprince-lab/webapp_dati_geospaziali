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
  return { map, markersLayer };
}

export function fitToMilan(mapContext) {
  if (!mapContext?.map) {
    return;
  }
  mapContext.map.setView(MILAN_CENTER, MILAN_ZOOM);
}

export function renderFountainsOnMap(mapContext, fountains) {
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

  if (bounds.length === 1) {
    map.setView(bounds[0], 15);
    return;
  }

  if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [32, 32] });
  }
}
