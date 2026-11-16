import { AcpError, aborted } from './errors.js';

export class EventQueue {
  #events = []; #waiter; #closed; #bytes = 0;
  constructor(maxBytes = 8 * 1024 * 1024) { this.maxBytes = maxBytes; }
  push(event) {
    if (this.#closed) return false;
    const size = Buffer.byteLength(JSON.stringify(event));
    if (this.#bytes + size > this.maxBytes) {
      this.close(new AcpError('ACP_BACKPRESSURE','ACP 输出超过缓冲上限；请求已停止。'));
      return false;
    }
    this.#events.push({event,size}); this.#bytes += size; this.#wake(); return true;
  }
  #wake() { this.#waiter?.(); this.#waiter = undefined; }
  close(error = new AcpError('ACP_CLOSED','ACP 事件流已关闭。')) {
    this.#closed ??= error;
    this.#events = []; this.#bytes = 0;
    this.#wake();
  }
  async next(signal) {
    aborted(signal);
    while (!this.#events.length) {
      if (this.#closed) throw this.#closed;
      await new Promise((resolve,reject) => {
        const cleanup = () => { signal?.removeEventListener('abort',onAbort); this.#waiter = undefined; };
        const onAbort = () => { cleanup(); reject(new AcpError('ACP_ABORTED','ACP 请求已取消。')); };
        this.#waiter = () => { cleanup(); resolve(); };
        signal?.addEventListener('abort',onAbort,{once:true});
        if (signal?.aborted) onAbort();
      });
    }
    aborted(signal);
    const {event,size} = this.#events.shift(); this.#bytes -= size; return event;
  }
}

/** Bounded global admission; parked prompts release admission between DSH steps. */
export class SerialGate {
  #busy = false; #waiters = [];
  constructor(maxWaiting = 32) { this.maxWaiting = maxWaiting; }
  async acquire(signal) {
    aborted(signal);
    if (!this.#busy) { this.#busy = true; return this.#release(); }
    if (this.#waiters.length >= this.maxWaiting) throw new AcpError('ACP_CAPACITY','ACP 等待队列已满。');
    return new Promise((resolve,reject) => {
      const waiter = {resolve,reject,signal};
      waiter.abort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index,1);
        reject(new AcpError('ACP_ABORTED','等待中的 ACP 请求已取消。'));
      };
      this.#waiters.push(waiter);
      signal?.addEventListener('abort',waiter.abort,{once:true});
      if (signal?.aborted) waiter.abort();
    });
  }
  #release() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.#waiters.shift();
      if (!waiter) { this.#busy = false; return; }
      waiter.signal?.removeEventListener('abort',waiter.abort);
      waiter.resolve(this.#release());
    };
  }
}
