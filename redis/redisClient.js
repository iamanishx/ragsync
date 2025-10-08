const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({
    url: redisUrl
});

redisClient.on('error', (err) => {
    console.error('Redis connection error:', err);
});

redisClient.on('connect', () => {
    console.log(`Redis client connected to: ${redisUrl}`);
});

(async () => {
    try {
        await redisClient.connect();
        console.log('Redis client successfully connected');
    } catch (error) {
        console.error('Failed to connect to Redis:', error);
    }
})();

module.exports = redisClient;
