require('dotenv').config();
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Player } = require("discord-player");
const fs = require('fs');
const path = require('path');
const vectorDB = require('./utils/vectorDB');
const { startPortal } = require('./utils/portal');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// Initialize collections for commands
client.commands = new Collection();
const commands = [];

// Load commands from the commands folder
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    // Ensure command is properly structured
    if (command.data && command.data.name) {
        client.commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
    } else if (command.name) {
        client.commands.set(command.name, command);
    }
}

// Initialize the Player instance
client.player = new Player(client, {
    ytdlOptions: {
        quality: "highestaudio",
        highWaterMark: 1 << 25,
    },
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setActivity('your activity', { type: 'WATCHING' });

    // Initialize vector database
    await vectorDB.initialize();

    // Start setup portal if enabled
    if (process.env.PORTAL_ENABLED === 'true') {
        try { startPortal(); } catch (e) { console.error('Failed to start portal:', e.message); }
    }

    // Register slash commands for each guild
    const guildIds = client.guilds.cache.map(guild => guild.id);
    const rest = new REST({ version: '9' }).setToken(process.env.TOKEN);

    for (const guildId of guildIds) {
        rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: commands })
            .then(() => console.log(`Successfully updated commands for guild ${guildId}`))
            .catch(console.error);
    }
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute({ client, interaction });
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: "There was an error executing this command.", ephemeral: true });
    }
});

// Handle prefix-based commands (e.g., !command)
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName);
    if (!command) return;

    try {
        await command.execute(message, args);
    } catch (error) {
        console.error(`Error executing command ${commandName}:`, error);
        message.channel.send('There was an error executing that command.');
    }
});

client.login(process.env.TOKEN);
