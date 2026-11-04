/**
 * Ask the browser to keep this site's storage (IndexedDB: the registers,
 * the send queue, the downloaded classes) even when the phone runs low on
 * space. Without it, a browser may clear the data of a site it considers
 * unimportant, taking records that have not been sent yet with it.
 *
 * Chrome decides on its own (it grants it to installed or often-used apps)
 * without asking the user; Firefox may show a prompt. Safe to call often.
 *
 * @returns {Promise<'granted'|'denied'|'unsupported'>}
 */
export async function requestPersistentStorage(storage = globalThis.navigator?.storage) {
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'granted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}
