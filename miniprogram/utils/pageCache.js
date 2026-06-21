const cacheStore = {};
export function readPageCache(key, ttlMs) {
    const entry = cacheStore[key];
    if (!entry)
        return null;
    if (Date.now() - entry.savedAt > ttlMs) {
        delete cacheStore[key];
        return null;
    }
    return entry.data;
}
export function writePageCache(key, data) {
    cacheStore[key] = {
        data,
        savedAt: Date.now()
    };
}
