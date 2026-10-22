export const TOUR_STORAGE_KEY = 'vidamix:tour';

/** A denied/quota-limited localStorage must never prevent using the application. */
export function createTourStorage(version, getStorage = () => window.localStorage) {
  const emptyState = () => ({ version, dismissed: false, pages: {} });
  let memory = emptyState();
  let available = true;
  let pendingWrite = false;

  function read() {
    // A failed write leaves localStorage older than this session. Retain the
    // user's latest choice until a subsequent update can persist it successfully.
    if (pendingWrite) return memory;

    let raw;
    try {
      raw = getStorage().getItem(TOUR_STORAGE_KEY);
      available = true;
    } catch {
      available = false;
      return memory;
    }

    try {
      const saved = JSON.parse(raw);
      if (saved?.version === version && saved.pages && typeof saved.pages === 'object'
        && !Array.isArray(saved.pages)) {
        memory = { version, dismissed: saved.dismissed === true, pages: saved.pages };
      } else {
        memory = emptyState();
      }
    } catch {
      // Invalid data or an obsolete version should offer a fresh tour.
      memory = emptyState();
    }
    return memory;
  }

  function update(page, status, stepId = null) {
    const state = read();
    memory = {
      ...state,
      dismissed: state.dismissed || status === 'dismissed',
      pages: {
        ...state.pages,
        [page]: { status, stepId, updatedAt: new Date().toISOString() },
      },
    };
    pendingWrite = true;
    try {
      getStorage().setItem(TOUR_STORAGE_KEY, JSON.stringify(memory));
      pendingWrite = false;
      available = true;
    } catch {
      available = false;
    }
    return memory;
  }

  return { read, update, get available() { return available; } };
}
