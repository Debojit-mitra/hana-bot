import logger from '../utils/logger.js';

/**
 * A generic Task Queue that executes promises sequentially or with limited concurrency.
 */
export class TaskQueue {
  private queue: (() => Promise<void>)[] = [];
  private activeCount = 0;

  constructor(private concurrency: number = 1) {}

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    this.activeCount++;
    const task = this.queue.shift();

    if (task) {
      try {
        await task();
      } catch (err) {
        logger.error({ err }, 'Error executing queued task');
      } finally {
        this.activeCount--;
        this.process();
      }
    } else {
      this.activeCount--;
    }
  }
}

/**
 * A Rolling-Window Rate Limiter specifically designed for the Gemini API.
 * Tracks requests per minute (RPM) and seamlessly fails over to a fallback model.
 * If both models are exhausted, it calculates the exact wait time and delays execution.
 */
export class AIRateLimiter {
  private primaryTimestamps: number[] = [];
  private fallbackTimestamps: number[] = [];
  
  // Track if a cooldown message was already sent to avoid spamming the user
  // while they wait for their slot. We track by chat JID.
  private cooldownNotified: Set<string> = new Set();

  constructor(
    private getPrimaryModel: () => string,
    private getFallbackModel: () => string | undefined,
    private getRpmLimit: () => number
  ) {}

  async execute<T>(
    chatJid: string,
    task: (model: string) => Promise<T>,
    onQueued: (waitSec: number) => Promise<void>
  ): Promise<T> {
    const now = Date.now();
    const windowMs = 60000; // 1 minute rolling window
    const limit = this.getRpmLimit();
    const primary = this.getPrimaryModel();
    const fallback = this.getFallbackModel();

    // Clean up expired timestamps
    this.primaryTimestamps = this.primaryTimestamps.filter(t => now - t < windowMs);
    this.fallbackTimestamps = this.fallbackTimestamps.filter(t => now - t < windowMs);

    let chosenModel: string | null = null;

    if (this.primaryTimestamps.length < limit) {
      chosenModel = primary;
      this.primaryTimestamps.push(now);
    } else if (fallback && this.fallbackTimestamps.length < limit) {
      chosenModel = fallback;
      this.fallbackTimestamps.push(now);
    }

    if (chosenModel) {
      this.cooldownNotified.delete(chatJid); // reset notification state on success
      return await task(chosenModel);
    }

    // Both buckets are full! Calculate exact wait time
    const oldestPrimary = this.primaryTimestamps[0] || now;
    const oldestFallback = fallback && this.fallbackTimestamps.length > 0 
        ? this.fallbackTimestamps[0] 
        : Number.MAX_SAFE_INTEGER;
        
    const oldest = Math.min(oldestPrimary, oldestFallback);
    const waitMs = (oldest + windowMs) - Date.now();

    if (waitMs > 0) {
      if (!this.cooldownNotified.has(chatJid)) {
        this.cooldownNotified.add(chatJid);
        await onQueued(Math.ceil(waitMs / 1000));
      }
      // Wait until the slot frees up
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    // Recurse to try again (it will grab the slot that just freed up)
    return this.execute(chatJid, task, onQueued);
  }
}
