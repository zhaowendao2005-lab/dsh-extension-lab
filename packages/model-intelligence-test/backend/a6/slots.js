/** Account/token locks shared by every running attempt. These are identities, never API keys. */
export class TokenSlots {
  constructor() { this.busy = new Set(); this.waiters = []; }
  acquire(id, signal) {
    if (signal?.aborted) return Promise.resolve(false);
    if (!this.busy.has(id)) { this.busy.add(id); return Promise.resolve(true); }
    return new Promise(resolve => {
      const entry = { id, signal, resolve, abort: null };
      entry.abort = () => {
        const index = this.waiters.indexOf(entry);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(false);
      };
      signal?.addEventListener('abort', entry.abort, { once: true });
      this.waiters.push(entry);
    });
  }
  release(id) {
    this.busy.delete(id);
    const index = this.waiters.findIndex(entry => entry.id === id && !entry.signal?.aborted);
    if (index < 0) return;
    const [entry] = this.waiters.splice(index, 1);
    entry.signal?.removeEventListener('abort', entry.abort);
    this.busy.add(id); entry.resolve(true);
  }
}
export function tokenIdentity(meta, tokenId) { return `${meta.siteOrigin}:${meta.accountId}:${tokenId}`; }
