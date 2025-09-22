module.exports = {
  name: 'gemini',
  description: 'Deprecated: use !rag with provider google',
  async execute(message) {
    return message.reply(
      'The Gemini command has been removed. Use the unified RAG command:\n' +
      '1) `!rag provider google`\n' +
      '2) `!rag setup google YOUR_GEMINI_API_KEY`\n' +
      '3) `!rag <your message>`'
    );
  },
};
