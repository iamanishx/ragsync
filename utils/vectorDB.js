const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class VectorDB {
    constructor() {
        this.qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
        this.collectionName = 'discord_conversations';
        this.embeddingProvider = (process.env.EMBEDDINGS_PROVIDER || 'huggingface').toLowerCase();
        this.embeddingModel = process.env.EMBEDDINGS_MODEL || (
            this.embeddingProvider === 'google' ? 'text-embedding-004' :
            this.embeddingProvider === 'openai' ? 'text-embedding-3-small' :
            this.embeddingProvider === 'openrouter' ? 'openai/text-embedding-3-small' :
            'BAAI/bge-base-en-v1.5'
        );
        this.embeddingDim = parseInt(process.env.EMBEDDINGS_DIM || '768', 10);
        this.fallbackEmbeddingModel = 'embedding-001';
    }

    async initialize() {
        try {
            await this.createCollection();
            console.log('Vector database initialized successfully');
        } catch (error) {
            console.error('Failed to initialize vector database:', error.message);
        }
    }

    async createCollection() {
        try {
            const response = await axios.get(`${this.qdrantUrl}/collections/${this.collectionName}`);
            console.log('Collection already exists');
        } catch (error) {
            if (error.response?.status === 404) {
                try {
                    await axios.put(`${this.qdrantUrl}/collections/${this.collectionName}`, {
                        vectors: {
                            size: this.embeddingDim,
                            distance: 'Cosine'
                        }
                    });
                    console.log(`Collection created successfully with ${this.embeddingDim}-dimensional vectors for embeddings`);
                } catch (createError) {
                    console.error('Failed to create collection:', createError.message);
                }
            } else {
                console.error('Error checking collection:', error.message);
            }
        }
    }

    async createEmbedding(text, _apiKeyIgnored, _userIdIgnored = null, isQuery = false) {
        const provider = this.embeddingProvider;
        const model = this.embeddingModel;

        try {
            if (provider === 'google') {
                const geminiKey = process.env.GEMINI_API_KEY;
                if (!geminiKey) throw new Error('GEMINI_API_KEY not set');
                const taskType = isQuery ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
                const res = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${geminiKey}`, {
                    content: { parts: [{ text }] },
                    taskType,
                    outputDimensionality: this.embeddingDim
                }, { headers: { 'Content-Type': 'application/json' } });
                return res.data.embedding.values;
            }

            if (provider === 'openai') {
                const key = process.env.OPENAI_API_KEY;
                if (!key) throw new Error('OPENAI_API_KEY not set');
                const res = await axios.post('https://api.openai.com/v1/embeddings', {
                    model,
                    input: text,
                    dimensions: this.embeddingDim
                }, { headers: { Authorization: `Bearer ${key}` } });
                return res.data.data[0].embedding;
            }

            if (provider === 'openrouter') {
                const key = process.env.OPENROUTER_API_KEY;
                if (!key) throw new Error('OPENROUTER_API_KEY not set');
                const res = await axios.post('https://openrouter.ai/api/v1/embeddings', {
                    model,
                    input: text,
                    dimensions: this.embeddingDim
                }, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
                return res.data.data[0].embedding;
            }

            if (provider === 'huggingface') {
                const hfToken = process.env.HF_TOKEN;
                if (!hfToken) throw new Error('HF_TOKEN not set');
                const res = await axios.post(`https://api-inference.huggingface.co/models/${model}`, {
                    inputs: text,
                    options: { wait_for_model: true }
                }, { headers: { Authorization: `Bearer ${hfToken}`, 'Content-Type': 'application/json' } });
                const data = res.data;
                if (Array.isArray(data) && Array.isArray(data[0])) {
                    const tokens = data;
                    const dim = tokens[0].length;
                    const pooled = new Array(dim).fill(0);
                    for (const vec of tokens) {
                        for (let i = 0; i < dim; i++) pooled[i] += vec[i];
                    }
                    for (let i = 0; i < dim; i++) pooled[i] /= tokens.length;
                    return pooled;
                }
                return data;
            }
        } catch (err) {
            console.error('Embedding API error:', err.response?.data || err.message);
        }

        console.log('Using local embedding generation as last resort...');
        return this.createLocalEmbedding(text);
    }

    createLocalEmbedding(text) {
    const embedding = new Array(this.embeddingDim).fill(0);
        const words = text.toLowerCase().split(/\s+/);
        const sentences = text.split(/[.!?]+/);
        const wordFreq = {};
        words.forEach(word => {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        });
        
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const freq = wordFreq[word];
            const position = i / words.length;
            
            for (let j = 0; j < word.length; j++) {
                const charCode = word.charCodeAt(j);
                const index1 = (charCode + i * 7 + j * 13) % this.embeddingDim;
                const index2 = (charCode * freq + i * 17) % this.embeddingDim;
                
                embedding[index1] += (1 + Math.log(freq)) * (1 - position * 0.1);
                embedding[index2] += Math.sin(charCode / 100) * freq;
            }
            
            if (i < words.length - 1) {
                const bigram = word + words[i + 1];
                for (let k = 0; k < Math.min(bigram.length, 10); k++) {
                    const index = (bigram.charCodeAt(k) * (k + 1) + i) % this.embeddingDim;
                    embedding[index] += 0.5;
                }
            }
        }
        
        sentences.forEach((sentence, idx) => {
            const sentenceLength = sentence.length;
            const index = (sentenceLength + idx * 31) % 768;
            embedding[index] += sentences.length > 1 ? 1 / sentences.length : 1;
        });
        
        const textLength = text.length;
        const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
        
        embedding[0] += Math.log(textLength + 1) / 10;
        embedding[1] += avgWordLength / 10;
        embedding[2] += words.length / 100;
        embedding[3] += sentences.length / 10;
        
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        return embedding.map(val => magnitude > 0 ? val / magnitude : 0);
    }

    async storeConversation(userId, guildId, channelId, userMessage, aiResponse, model, apiKey) {
        try {
            const conversationText = `User: ${userMessage}\nAssistant: ${aiResponse}`;
            const embedding = await this.createEmbedding(conversationText, apiKey, userId, false);
            
            const point = {
                id: uuidv4(),
                vector: embedding,
                payload: {
                    guildId,
                    userId,
                    channelId,
                    userMessage,
                    aiResponse,
                    model,
                    timestamp: new Date().toISOString(),
                    conversationText
                }
            };

            await axios.put(`${this.qdrantUrl}/collections/${this.collectionName}/points`, {
                points: [point]
            });

            console.log('Conversation stored in vector database');
        } catch (error) {
            console.error('Error storing conversation in vector DB:', error.message);
        }
    }

    async searchSimilarConversations(query, userId, guildId, channelId, apiKey, limit = 5) {
        try {
            const queryEmbedding = await this.createEmbedding(query, apiKey, userId, true); // true = isQuery
            console.log(`Query embedding length: ${Array.isArray(queryEmbedding) ? queryEmbedding.length : 'invalid'}`);
            
            const searchResponse = await axios.post(`${this.qdrantUrl}/collections/${this.collectionName}/points/search`, {
                vector: queryEmbedding,
                filter: {
                    must: [
                        { key: 'guildId', match: { value: guildId } },
                        { key: 'userId', match: { value: userId } },
                        { key: 'channelId', match: { value: channelId } }
                    ]
                },
                limit,
                with_payload: true
            });

            return searchResponse.data.result.map(result => ({
                score: result.score,
                userMessage: result.payload.userMessage,
                aiResponse: result.payload.aiResponse,
                timestamp: result.payload.timestamp,
                model: result.payload.model
            }));
        } catch (error) {
            console.error('Error searching similar conversations:', error.response?.data || error.message);
            return [];
        }
    }

    async getRecentConversations(userId, guildId, channelId, limit = 10) {
        try {
            const scrollResponse = await axios.post(`${this.qdrantUrl}/collections/${this.collectionName}/points/scroll`, {
                filter: {
                    must: [
                        { key: 'guildId', match: { value: guildId } },
                        { key: 'userId', match: { value: userId } },
                        { key: 'channelId', match: { value: channelId } }
                    ]
                },
                limit,
                with_payload: true,
                order_by: [{ key: 'timestamp', direction: 'desc' }]
            });

            return scrollResponse.data.result.points.map(point => ({
                userMessage: point.payload.userMessage,
                aiResponse: point.payload.aiResponse,
                timestamp: point.payload.timestamp,
                model: point.payload.model
            }));
        } catch (error) {
            console.error('Error getting recent conversations:', error.message);
            return [];
        }
    }

    async clearUserHistory(userId, guildId, channelId) {
        try {
            await axios.post(`${this.qdrantUrl}/collections/${this.collectionName}/points/delete`, {
                filter: {
                    must: [
                        { key: 'guildId', match: { value: guildId } },
                        { key: 'userId', match: { value: userId } },
                        { key: 'channelId', match: { value: channelId } }
                    ]
                }
            });
            console.log('User history cleared from vector database');
        } catch (error) {
            console.error('Error clearing user history:', error.message);
        }
    }
}

module.exports = new VectorDB();
