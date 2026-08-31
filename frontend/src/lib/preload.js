// Image preloading for the play path.
//
// Items were appearing late and unevenly: an <img> starts fetching only when
// it mounts, so a memory item flashed empty frames while its pictures arrived,
// and the four-second "look at these" window was spent partly on a blank grid.
// That is not a cosmetic problem -- the exposure time IS the measurement, and
// a patient who sees three pictures for two seconds and one for four has not
// taken the same test as anyone else.
//
// A whole session is about sixteen images and roughly 1.3 MB. Fetching them
// before the first item renders costs one short wait at the start instead of a
// stutter at every item.

/** Fetch and DECODE one image. Resolves either way -- never blocks play. */
export function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // decode() matters: onload means "downloaded", not "ready to paint".
      // Without it the first paint can still stutter on a large JPEG.
      if (typeof img.decode === "function") {
        img.decode().then(() => resolve(url)).catch(() => resolve(url));
      } else {
        resolve(url);
      }
    };
    img.onerror = () => resolve(null); // a missing image must not hang a session
    img.src = url;
  });
}

/** Every image URL an item will ask for. */
export function imageUrlsFor(item) {
  const urls = [];
  if (item.show?.urls) urls.push(...item.show.urls);
  if (item.ask?.options && item.template === "which-did-you-see") {
    urls.push(...item.ask.options.map((k) => `/items/objects/${k}.jpg`));
  }
  if (item.imageUrl) urls.push(item.imageUrl);
  return urls;
}

/**
 * Warm the cache for a list of items.
 *
 * Resolves when everything has loaded or failed. Callers should show a calm
 * "Ready?" while it runs and start anyway if it takes too long -- an offline
 * device with a cold cache must still be able to play.
 */
export async function preloadItems(items, { timeoutMs = 8000 } = {}) {
  const urls = [...new Set(items.flatMap(imageUrlsFor))];
  if (urls.length === 0) return { loaded: 0, failed: [], timedOut: false };

  const settled = Promise.all(urls.map(preloadImage));
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve("__timeout__"), timeoutMs)
  );

  const result = await Promise.race([settled, timeout]);
  if (result === "__timeout__") {
    return { loaded: 0, failed: [], timedOut: true, total: urls.length };
  }
  return {
    loaded: result.filter(Boolean).length,
    failed: urls.filter((u, i) => result[i] === null),
    timedOut: false,
    total: urls.length,
  };
}
