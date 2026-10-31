interface RateLimitEntry {
  tokens: number
  lastRefill: number
}

class TokenBucket {
  private buckets = new Map<string, RateLimitEntry>()
  private maxTokens: number
  private refillRatePerMs: number

  constructor(maxTokens: number, refillPeriodMs: number) {
    this.maxTokens = maxTokens
    this.refillRatePerMs = maxTokens / refillPeriodMs
  }

  consume(key: string, cost = 1): boolean {
    const now = Date.now()
    let entry = this.buckets.get(key)
    if (!entry) {
      entry = { tokens: this.maxTokens, lastRefill: now }
      this.buckets.set(key, entry)
    } else {
      const elapsed = now - entry.lastRefill
      entry.tokens = Math.min(this.maxTokens, entry.tokens + elapsed * this.refillRatePerMs)
      entry.lastRefill = now
    }

    if (entry.tokens >= cost) {
      entry.tokens -= cost
      return true
    }
    return false
  }

  cleanExpired(olderThanMs = 3600000): void {
    const cutoff = Date.now() - olderThanMs
    for (const [key, entry] of this.buckets.entries()) {
      if (entry.lastRefill < cutoff) {
        this.buckets.delete(key)
      }
    }
  }
}

// 20 execution jobs per 60 seconds per session
export const executionLimiter = new TokenBucket(20, 60_000)

// 15 AI requests per 60 seconds per session
export const aiLimiter = new TokenBucket(15, 60_000)
