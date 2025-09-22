const axios = require('axios');
const { getCache, setCache } = require('../redis/redisUtils');
const vectorDB = require('../utils/vectorDB');
const { chatWithProvider } = require('../utils/llmProvider');

module.exports = {
    name: 'rag',
    description: 'Chat with AI models through OpenRouter with vector-based memory',
    async execute(message, args) {
        const subcommand = args[0];
        const userId = message.author.id;
        
        try {
            switch (subcommand) {
                case 'setup':
                    await handleSetup(message, args.slice(1), userId);
                    break;
                case 'models':
                    await handleModels(message, args.slice(1), userId);
                    break;
                case 'provider':
                    await handleProviderSelect(message, args.slice(1), userId);
                    break;
                case 'select':
                    await handleModelSelect(message, args.slice(1), userId);
                    break;
                case 'chat':
                    await handleChat(message, args.slice(1), userId);
                    break;
                case 'clear':
                    await handleClearHistory(message, userId);
                    break;
                case 'search':
                    await handleSearchHistory(message, args.slice(1), userId);
                    break;
                case 'plan':
                    await handlePlan(message, args.slice(1), userId);
                    break;
                default:
                    if (!subcommand) {
                        await handleChat(message, args, userId);
                    } else {
                        await message.reply(`Unknown command. Use: \`!rag setup <provider> <API_KEY>\`, \`!rag provider <openrouter|groq|anthropic|google|openai|gemini>\`, \`!rag models\`, \`!rag select <model_name>\`, \`!rag chat <message>\`, \`!rag search <query>\`, \`!rag plan <basic|pro>\`, or \`!rag clear\`\n(Note: Embeddings are managed centrally and do not require your key.)`);
                    }
                    break;
            }
        } catch (error) {
            console.error('Error in RAG command:', error.message);
            await message.reply('An error occurred while processing your request.');
        }
    },
};

async function handleSetup(message, args, userId) {
    if (!args[0] || !args[1]) {
        return message.reply('Please provide provider and API key: `!rag setup <provider> <API_KEY>` (providers: openrouter|groq|anthropic|google|gemini|openai)');
    }
    const provider = args[0].toLowerCase() === 'gemini' ? 'google' : args[0].toLowerCase();
    const apiKey = args[1];
    const userKeyCache = `user:${userId}:${provider}_key`;
    await setCache(userKeyCache, apiKey, 86400 * 30);
    await message.reply(`API key stored for provider: ${provider}.`);
}

async function handleModels(message, args, userId) {
    const showPaid = args[0] === 'paid';
    const provider = (await getCache(`user:${userId}:selected_provider`)) || 'openrouter';
    const apiKey = await getCache(`user:${userId}:${provider}_key`) || process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
        return message.reply('Please setup your API key first: `!rag setup YOUR_API_KEY`');
    }
    
    try {
        const baseURL = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : provider === 'groq' ? 'https://api.groq.com/openai/v1' : null;
        if (!baseURL) {
            return message.reply('Listing models is supported for OpenRouter and Groq via this command.');
        }
        const response = await axios.get(`${baseURL}/models`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        const models = response.data.data;
        const filteredModels = models.filter(model => {
            const isFree = model.pricing?.prompt === '0' && model.pricing?.completion === '0';
            return showPaid ? !isFree : isFree;
        });
        
        if (filteredModels.length === 0) {
            return message.reply(`No ${showPaid ? 'paid' : 'free'} models available.`);
        }
        
        let modelList = `**${showPaid ? 'Paid' : 'Free'} Models Available:**\n\n`;
        filteredModels.slice(0, 15).forEach((model, index) => {
            const contextWindow = model.context_length ? `${model.context_length}k` : 'Unknown';
            modelList += `${index + 1}. **${model.id}**\n   Context: ${contextWindow} | ${model.name || 'No description'}\n\n`;
        });
        
        if (filteredModels.length > 15) {
            modelList += `... and ${filteredModels.length - 15} more models\n\n`;
        }
        
        modelList += `\nUse \`!rag select <model_id>\` to choose a model\n`;
        modelList += `Use \`!rag models ${showPaid ? '' : 'paid'}\` to see ${showPaid ? 'free' : 'paid'} models\n`;
        
        await message.channel.send(modelList);
        
    } catch (error) {
        console.error('Error fetching models:', error.response?.data || error.message);
        await message.reply('Failed to fetch models. Please check your API key.');
    }
}

async function handleModelSelect(message, args, userId) {
    if (!args[0]) {
        return message.reply('Please specify a model: `!rag select <model_id>`');
    }
    
    const modelId = args.join('/'); 
    const userModelCache = `user:${userId}:selected_model`;
    
    await setCache(userModelCache, modelId, 86400 * 30); 
    await message.reply(`Model selected: **${modelId}**\nYou can now start chatting with \`!rag chat <message>\` or just \`!rag <message>\`\n\n*Tip: Use \`!rag clear\` if conversations get too long for the context window.*`);
}

async function handleProviderSelect(message, args, userId) {
    const input = args[0]?.toLowerCase();
    const provider = input === 'gemini' ? 'google' : input;
    if (!provider || !['openrouter', 'groq', 'anthropic', 'google', 'openai'].includes(provider)) {
        return message.reply('Please specify a provider: `!rag provider <openrouter|groq|anthropic|google|gemini|openai>`');
    }
    await setCache(`user:${userId}:selected_provider`, provider, 86400 * 30);

    const currentModel = await getCache(`user:${userId}:selected_model`);
    console.log('Current selected model:', currentModel);
    if (!currentModel) {
        const defaults = {
            openrouter: 'deepseek/deepseek-r1-0528-qwen3-8b:free',
            groq: 'llama-3.1-8b-instant',
            anthropic: 'claude-3-5-sonnet-latest',
            google: 'gemini-1.5-flash',
            openai: 'gpt-4o-mini'
        };
        await setCache(`user:${userId}:selected_model`, defaults[provider], 86400 * 30);
    }
    await message.reply(`Provider selected: ${provider}`);
}

async function handlePlan(message, args, userId) {
    const plan = args[0]?.toLowerCase();
    if (!plan || !['basic', 'pro'].includes(plan)) {
        return message.reply('Please specify a plan: `!rag plan <basic|pro>`');
    }
    const guildId = message.guild?.id;
    if (!guildId) return message.reply('This command must be used in a server.');
    await setCache(`guild:${guildId}:plan`, plan, 86400 * 30);
    await message.reply(`Plan set for this server: ${plan}`);
}

async function handleChat(message, args, userId) {
    if (!args.length) {
        return message.reply('Please provide a message to chat.');
    }
    
    const guildId = message.guild?.id || 'dm';
    const provider = (await getCache(`user:${userId}:selected_provider`)) || process.env.DEFAULT_PROVIDER || 'openrouter';
    const selectedModel = (await getCache(`user:${userId}:selected_model`)) || process.env.DEFAULT_MODEL || 'deepseek/deepseek-r1-0528-qwen3-8b:free';
    const apiKey = (await getCache(`user:${userId}:${provider}_key`))
        || (guildId !== 'dm' ? await getCache(`guild:${guildId}:${provider}_key`) : null)
        || (provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : provider === 'groq' ? process.env.GROQ_API_KEY : provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : provider === 'google' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);
    
    if (!apiKey) {
        return message.reply('No API key found for the selected provider. Add one with `!rag setup <provider> <API_KEY>` (e.g., `!rag setup google <GEMINI_KEY>` or `!rag setup openrouter <OPENROUTER_KEY>`), or set env defaults.');
    }
    
    const userMessage = args.join(' ');
    const channelId = message.channel.id;
    
    try {
        await message.channel.sendTyping();
        
        console.log('Searching similar conversations...');
    const similarConversations = await vectorDB.searchSimilarConversations(userMessage, userId, guildId, channelId, apiKey, 3);
        console.log('Found similar conversations:', similarConversations);
        
    const recentHistory = await getConversationHistory(userId, guildId, channelId);
        console.log('Recent history messages:', recentHistory.length);

        const contextParts = [];
        const similarHigh = (similarConversations || []).filter(c => c.score && c.score > 0.7).slice(0, 3);
        if (similarHigh.length) {
            contextParts.push('Similar past Q&A (highest matches):');
            for (const c of similarHigh) {
                contextParts.push(`- Q: ${c.userMessage}`);
                contextParts.push(`  A: ${c.aiResponse.substring(0, 200)}${c.aiResponse.length > 200 ? '…' : ''}`);
            }
            contextParts.push('');
        }
        if (recentHistory.length) {
            contextParts.push('Recent chat history (last few turns):');
            const lastTurns = recentHistory.slice(-10); // already sanitized
            for (const h of lastTurns) {
                const tag = h.role === 'user' ? 'User' : 'Assistant';
                contextParts.push(`- ${tag}: ${h.content}`);
            }
        }
        const contextBlock = contextParts.length
            ? `BEGIN CONTEXT\n${contextParts.join('\n')}\nEND CONTEXT\n\nAnswer the following user message using the context if helpful.`
            : 'No prior context available. Answer the following user message.';
        
        const messages = [
            {
                role: 'system',
                content: 'You are a helpful AI assistant. Answer the user\'s questions directly and accurately. Use relevant conversation history to give contextual responses. Be concise but informative. Do not include hidden reasoning, chain-of-thought, or <think> content; provide only the final answer. Do not comment about being an AI, a language model, or your training unless the user explicitly asks.'
            },
            { role: 'system', content: contextBlock },
            {
                role: 'user',
                content: userMessage
            }
        ];
        const trimmedMessages = trimContextMessages(messages, 8000);

        console.log(`Using ${trimmedMessages.length} messages for context`);
        console.log('Final messages to API:', JSON.stringify(trimmedMessages, null, 2));
        
        let { text: aiResponse } = await chatWithProvider({
            provider,
            apiKey,
            model: selectedModel,
            messages: trimmedMessages,
            temperature: 0.7,
            maxTokens: 1000,
            headers: { 'HTTP-Referer': 'https://discord.com', 'X-Title': 'Discord Bot' },
        });
        aiResponse = sanitizeAIResponse(aiResponse);
        console.log('API Response:', aiResponse);
        
    await storeConversation(userId, guildId, channelId, userMessage, aiResponse, selectedModel);
    await vectorDB.storeConversation(userId, guildId, channelId, userMessage, aiResponse, selectedModel, apiKey);
    await sendResponseWithTyping(message.channel, aiResponse);
        
    } catch (error) {
        console.error('Error in chat:', error.response?.data || error.message);
        
        if (error.response?.status === 401) {
            await message.reply('Invalid API key for the selected provider. Re-run `!rag setup <provider> <API_KEY>`.');
        } else if (error.response?.status === 400) {
            console.error('Bad request details:', error.response?.data);
            await message.reply('Invalid model or request. Please select a different model or try again.');
        } else if (error.response?.status === 500) {
            console.error('Server error details:', error.response?.data);
            await message.reply('Provider server error. The messages may be too long or malformed. Try `!rag clear` to reset history.');
        } else if (error.response?.status === 413 || error.message.includes('context')) {
            await message.reply('Message too long for model context. Try a shorter message or use `!rag clear` to reset conversation history.');
        } else {
            await message.reply('An error occurred while processing your message. Please try again.');
        }
    }
}

async function handleClearHistory(message, userId) {
    const channelId = message.channel.id;
    const guildId = message.guild?.id || 'dm';
    const historyKey = `conversation:${guildId}:${channelId}:${userId}`;
    
    try {
    await setCache(historyKey, JSON.stringify([]), 86400 * 7);
    await vectorDB.clearUserHistory(userId, guildId, channelId);
        
        await message.reply('Conversation history cleared for this channel.');
    } catch (error) {
        console.error('Error clearing history:', error);
        await message.reply('Failed to clear history.');
    }
}

async function handleSearchHistory(message, args, userId) {
    if (!args.length) {
        return message.reply('Please provide a search query: `!rag search <query>`');
    }
    
    const query = args.join(' ');
    const channelId = message.channel.id;
    const guildId = message.guild?.id || 'dm';
    const provider = (await getCache(`user:${userId}:selected_provider`)) || 'openrouter';
    const apiKey = await getCache(`user:${userId}:${provider}_key`) || process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
        return message.reply('Please setup your API key first: `!rag setup YOUR_API_KEY`');
    }
    
    try {
        await message.channel.sendTyping();
        
    const similarConversations = await vectorDB.searchSimilarConversations(query, userId, guildId, channelId, apiKey, 5);
        
        if (similarConversations.length === 0) {
            return message.reply('No relevant conversations found.');
        }
        
        let searchResults = `**Search results for: "${query}"**\n\n`;
        
        similarConversations.forEach((conv, index) => {
            const date = new Date(conv.timestamp).toLocaleDateString();
            const similarity = Math.round(conv.score * 100);
            
            searchResults += `**${index + 1}. (${similarity}% match) - ${date}**\n`;
            searchResults += `**User:** ${conv.userMessage.substring(0, 100)}${conv.userMessage.length > 100 ? '...' : ''}\n`;
            searchResults += `**AI:** ${conv.aiResponse.substring(0, 150)}${conv.aiResponse.length > 150 ? '...' : ''}\n`;
            searchResults += `**Model:** ${conv.model}\n\n`;
        });
        
        if (searchResults.length > 2000) {
            const chunks = splitMessage(searchResults);
            for (const chunk of chunks) {
                await message.channel.send(chunk);
            }
        } else {
            await message.channel.send(searchResults);
        }
        
    } catch (error) {
        console.error('Error searching history:', error);
        await message.reply('Failed to search conversation history.');
    }
}

async function getConversationHistory(userId, guildId, channelId) {
    const historyKey = `conversation:${guildId}:${channelId}:${userId}`;
    const cachedHistory = await getCache(historyKey);
    
    if (!cachedHistory) {
        return [];
    }
    
    try {
        const raw = JSON.parse(cachedHistory);
        const history = sanitizeHistory(raw);
        // Keep last 10 messages (5 turns), already sanitized
        return history.slice(-10);
    } catch (error) {
        console.error('Error parsing history:', error);
        return [];
    }
}

async function storeConversation(userId, guildId, channelId, userMessage, aiResponse, model) {
    const historyKey = `conversation:${guildId}:${channelId}:${userId}`;
    const history = await getConversationHistory(userId, guildId, channelId);
    
    history.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: aiResponse }
    );
    
    const trimmedHistory = history.slice(-20);
    
    await setCache(historyKey, JSON.stringify(trimmedHistory), 86400 * 7);
}


function trimContextMessages(messages, maxChars) {
    const body = [];
    let totalChars = 0;
    
    if (messages[0]?.role === 'system') {
        // hold system separately to prepend later
        totalChars += messages[0].content.length;
    }
    
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'user') {
        totalChars += lastMessage.content.length;
    }
    
    for (let i = messages.length - 2; i >= 1; i--) {
        if (!messages[i] || !messages[i].content) continue;
        const messageChars = messages[i].content.length;
        if (totalChars + messageChars <= maxChars) {
            body.push(messages[i]);
            totalChars += messageChars;
        } else {
            break;
        }
    }
    
    const ordered = [];
    if (messages[0]?.role === 'system') ordered.push(messages[0]);
    // body was collected newest->older; reverse to older->newer
    for (let i = body.length - 1; i >= 0; i--) ordered.push(body[i]);
    if (lastMessage?.role === 'user') ordered.push(lastMessage);
    return ordered;
}

function sanitizeHistory(history) {
    // Remove malformed entries and generic AI disclaimers that bias answers
    const isGenericAI = (text) => /\b(I am (an|a) large language model|as an ai (language )?model)\b/i.test(text);
    const sanitized = [];
    for (const item of Array.isArray(history) ? history : []) {
        if (!item || typeof item !== 'object') continue;
        const { role, content } = item;
        if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
        const trimmed = content.trim();
        if (!trimmed) continue;
        if (role === 'assistant' && isGenericAI(trimmed)) continue;
        sanitized.push({ role, content: trimmed });
    }
    // Optionally deduplicate consecutive identical messages
    const deduped = [];
    for (const msg of sanitized) {
        const prev = deduped[deduped.length - 1];
        if (prev && prev.role === msg.role && prev.content === msg.content) continue;
        deduped.push(msg);
    }
    return deduped;
}

async function sendResponseWithTyping(channel, response) {
    const chunks = splitMessage(response, 1500); 
    
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        await channel.sendTyping();
        
        const typingDelay = Math.min(Math.max(chunk.length * 30, 1000), 4000);
        await new Promise(resolve => setTimeout(resolve, typingDelay));
        
        await channel.send(chunk);
        
        if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 800));
        }
    }
}

function splitMessage(message, maxLength = 2000) {
    const chunks = [];
    while (message.length > 0) {
        let chunk = message.slice(0, maxLength);
        const lastNewline = chunk.lastIndexOf('\n');
        const lastSpace = chunk.lastIndexOf(' ');
        const lastSentence = chunk.lastIndexOf('. ');
        
        if (lastSentence > -1 && lastSentence > maxLength * 0.6) {
            chunk = message.slice(0, lastSentence + 2);
        } else if (lastNewline > -1 && lastNewline > maxLength * 0.5) {
            chunk = message.slice(0, lastNewline + 1);
        } else if (lastSpace > -1 && lastSpace > maxLength * 0.5) {
            chunk = message.slice(0, lastSpace + 1);
        }
        
        chunks.push(chunk.trim());
        message = message.slice(chunk.length).trim();
    }
    return chunks.filter(chunk => chunk.length > 0);
}

function sanitizeAIResponse(text) {
    if (!text) return '';
    // Remove <think>...</think> style tags if any provider leaks them
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // Trim generic leading disclaimers
    cleaned = cleaned.replace(/^\s*(As an AI(?: language)? model[,\s])/i, '');
    return cleaned.trim();
}
