// <modify> Share a small priority budget between visible video loads and background prewarming.
export class PreloadQueue {
  constructor(concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('Invalid preload concurrency');
    this.concurrency = concurrency;
    this.active = 0;
    this.pending = [];
    this.jobs = new Map();
  }

  run(key, task, priority = 0) {
    const existing = this.jobs.get(key);
    if (existing) {
      existing.priority = Math.max(existing.priority, priority);
      // <modify> A hover can promote an already queued warmup into the reserved interactive slot.
      this.drain();
      return existing.promise;
    }
    let resolve, reject;
    const promise = new Promise((ok, bad) => { resolve = ok; reject = bad; });
    // Background jobs may outlive a card; callers can still observe the original rejection.
    promise.catch(() => {});
    const job = { key, task, priority, promise, resolve, reject };
    this.jobs.set(key, job);
    this.pending.push(job);
    this.drain();
    return promise;
  }

  drain() {
    /* <modify> Previously every request shared the same two slots:
    while (this.active < this.concurrency && this.pending.length) {
    */
    while (this.pending.length) {
      this.pending.sort((a, b) => b.priority - a.priority);
      // Keep the background budget, plus at most one extra load for a direct interaction.
      const limit = this.concurrency + (this.pending[0].priority >= 200 ? 1 : 0);
      if (this.active >= limit) break;
      const job = this.pending.shift();
      this.active++;
      Promise.resolve().then(job.task).then(
        value => this.finish(job, job.resolve, value),
        error => this.finish(job, job.reject, error),
      );
    }
  }

  finish(job, settle, value) {
    this.active--;
    this.jobs.delete(job.key);
    settle(value);
    this.drain();
  }
}
