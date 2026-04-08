const API_BASE = "/api";

async function request(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.message || `Errore HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload?.data ?? {};
}

export async function fetchHealth() {
  return request("/health");
}

export async function fetchFountainsByNil(nilName) {
  const data = await request(`/fontanelle/nil/${encodeURIComponent(nilName)}`);
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchNilStats() {
  const data = await request("/fontanelle/stats/nil");
  return Array.isArray(data.items) ? data.items : [];
}
