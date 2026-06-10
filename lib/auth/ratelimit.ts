import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let _limiter: Ratelimit | null = null;

function getLimiter(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!_limiter) {
    _limiter = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.fixedWindow(5, '15 m'),
      prefix: 'login',
    });
  }
  return _limiter;
}

/** Returns true if the IP is rate-limited (should block), false otherwise. Fails open when Redis is not configured. */
export async function isLoginRateLimited(ip: string): Promise<boolean> {
  const limiter = getLimiter();
  if (!limiter) return false;
  try {
    const { success } = await limiter.limit(ip);
    return !success;
  } catch {
    return false;
  }
}
