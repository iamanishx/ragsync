const redis = require('./redisClient');

async function checkRateLimit({ key, limit, windowSec = 60 }) {
  const redisKey = `rl:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSec);
    }
    const ttl = await redis.ttl(redisKey);
    return {
      allowed: count <= limit,
      remaining: Math.max(limit - count, 0),
      resetInSec: ttl > 0 ? ttl : windowSec,
      count,
    };
  } catch (err) {
    console.error('Rate limiter error:', err.message);
    return { allowed: true, remaining: limit, resetInSec: windowSec, count: 0 };
  }
}

module.exports = { checkRateLimit };
