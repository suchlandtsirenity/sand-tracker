async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    throw new Error(error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? true : res.json();
}

const levelPath = (key) => `/api/levels/${encodeURIComponent(key)}`;

export const api = {
  listLevels: () => req('GET', '/api/levels'),
  getLevel: (key) => req('GET', levelPath(key)),
  putLevel: (key, level) => req('PUT', levelPath(key), level),
  deleteLevel: (key) => req('DELETE', levelPath(key)),
  getPalettes: () => req('GET', '/api/palettes'),
  putPalettes: (list) => req('PUT', '/api/palettes', list),
};
