import chalk from 'chalk';

import config from '../config.js';

import { commands, generateRandomDelay } from '../index.js';

import db from '../db.js';

class ReplyManager {

  constructor() {

    this.replyListeners = new Map();

  }

  registerReplyListener(messageId, callback, options = {}) {

    const { timeout = 5 * 60 * 1000, oneTime = true, filter = () => true } = options;

    const listener = {

      callback,

      createdAt: Date.now(),

      timeout,

      oneTime,

      filter,

    };

    this.replyListeners.set(messageId, listener);

    setTimeout(() => {

      this.removeReplyListener(messageId);

    }, timeout);

  }

  async handleReply(api, message) {

  const replyListener = this.replyListeners.get(message.messageReply.messageID);

  if (!replyListener) return false;

  if (!replyListener.filter(message)) return false;

  try {

    await replyListener.callback(message);

    if (replyListener.oneTime) {

      this.removeReplyListener(message.messageReply.messageID);

    }

    return true;

  } catch (error) {

    console.error(chalk.red('Error in reply listener:'), error);

    this.removeReplyListener(message.messageReply.messageID);

    return false;

  }

}

  removeReplyListener(messageId) {

    this.replyListeners.delete(messageId);

  }

  cleanupExpiredListeners() {

    const now = Date.now();

    for (const [messageId, listener] of this.replyListeners.entries()) {

      if (now - listener.createdAt > listener.timeout) {

        this.replyListeners.delete(messageId);

      }

    }

  }

}

const replyManager = new ReplyManager();

export default async function commandHandler(api, message) {

  const nexusMessage = {

    reply: async (response) => {

      api.sendMessage(response, message.threadID, message.messageID);

    },

    replyWithCallback: async (response, callback) => {

      const sentMessage = await api.sendMessage(response, message.threadID, message.messageID);

      replyManager.registerReplyListener(sentMessage.messageID, callback);

    },

  };

  const groupPrefix = db.getGroupPrefix(message.threadID) || config.prefix;

  const messageBody = message.body ? message.body.trim() : '';

  console.log('Message object:', message);

  if (message.type === 'message_reply') {

    const originalMessageID = message.messageReply.messageID;

    const replyListener = replyManager.replyListeners.get(originalMessageID);

    if (replyListener) {

await replyListener.callback(message);

      delete replyManager.replyListeners[originalMessageID];

      return;

    }

  }

if (db.isBannedUser(message.senderID)) {

      const reason = db.readDB().bannedUsers[message.senderID];

      nexusMessage.reply(`You have been banned from using this bot. Reason: ${reason}`);

      return;

    }

  if (message.type === 'typ' || message.type === 'presence') {

    return;

  }

for (const command of commands.values()) {

  if (command.onChat && typeof command.onChat === 'function' && messageBody.toLowerCase().startsWith(command.config.name.toLowerCase() + ' ')) {

    console.log(chalk.green(`Calling onChat function for command: ${command.config.name}`));

    const args = messageBody.trim().split(' ').slice(1);

    command.onChat({ api, message, args, config, nexusMessage, onReply: async (reply) => { await command.onReply?.({ api, message, reply, config, nexusMessage }); }, sendMessage: async (text) => { const sentMessage = await api.sendMessage(text, message.threadID); return sentMessage; }, });

  } else if (command.onChat && typeof command.onChat === 'function' && messageBody.toLowerCase() === command.config.name.toLowerCase()) {

    console.log(chalk.green(`Calling onChat function for command: ${command.config.name}`));

    const args = [];

    command.onChat({ api, message, args, config, nexusMessage, onReply: async (reply) => { await command.onReply?.({ api, message, reply, config, nexusMessage }); }, sendMessage: async (text) => { const sentMessage = await api.sendMessage(text, message.threadID); return sentMessage; }, });

  }

}

  if (messageBody === groupPrefix) {

  nexusMessage.reply(`That is the bot prefix. Type !help to see all commands.`);

  return;

}

if (!messageBody.startsWith(groupPrefix)) {

    return;

  }

  const args = messageBody.slice(groupPrefix.length).trim().split(/ +/);

  const commandName = args.shift().toLowerCase();

  // Check if the command name is an alias for another command

  const command = Array.from(commands.values()).find((command) => {

    return command.config.name.toLowerCase() === commandName ||

      (command.config.aliases && command.config.aliases.includes(commandName));

  });

if (command && command.onLoad) {

    await command.onLoad({ api, message });

  }

  if (!command) {

    nexusMessage.reply(`Command "${commandName}" not found. Type !help to see all commands.`);

    return;

  }

  // Check if a command with the same name has an onChat function defined

  const commandWithOnChat = Array.from(commands.values()).find((cmd) => cmd.config.name.toLowerCase() === commandName && cmd.onChat);

  if (commandWithOnChat && !command.run && !command.onStart && !command.Nexus) {

  nexusMessage.reply(`The command "${commandName}" works without a prefix. You can use it by typing "${commandName}" followed by your query without prefix.`);

  return;

}

  if (command.config && command.config.permission === 1 && !config.adminIds.includes(message.senderID)) {

    nexusMessage.reply('You do not have permission to use this command.');

    return;

  }

if (command.config && command.config.permission === 2) {

  const isAdmin = await api.getThreadInfo(message.threadID);

  const isAdminVar = isAdmin.participantIDs.includes(message.senderID) && isAdmin.adminIDs.some(admin => admin.id === message.senderID);

  if (!isAdminVar) {

    nexusMessage.reply('You need to be a group admin to use this command.');

    return;

  }

}

if (command.config && command.config.cooldown) {

  const cooldownTime = command.config.cooldown * 1000;

  const cooldownKey = `cooldown_${command.config.name}_${message.senderID}`;

  const lastUsedTimestamp = db.get(cooldownKey);

  if (lastUsedTimestamp) {

    const timeRemaining = cooldownTime - (Date.now() - lastUsedTimestamp);

    if (timeRemaining > 0) {

      nexusMessage.reply(`You need to wait, you have ${Math.ceil(timeRemaining / 1000)} seconds before using this command again.`);

      return;

    }

  }

  db.set(cooldownKey, Date.now());

  setTimeout(() => {

    delete db[cooldownKey];

  }, cooldownTime);

}

  try {

    setTimeout(async () => {

      try {

        let response;

        const enhancedSendMessage = async (text, options = {}) => {

  const sentMessage = await api.sendMessage(text, message.threadID);

  if (options.onReply) {

    replyManager.registerReplyListener(sentMessage.messageID, async (reply) => {

      if (command.onReply) {

        console.log(chalk.green(`Calling onReply function for command: ${command.config.name}`));

        await command.onReply({ api, message, reply, config, nexusMessage, sendMessage: enhancedSendMessage });

      }

      if (options.onReply) {

        await options.onReply(reply);

      }

    }, { 

      timeout: options.replyTimeout || 5 * 60 * 1000, 

      oneTime: options.oneTimeReply ?? true, 

      filter: (message) => message.body !== '' 

    });

  }

  return { ...sentMessage, replyMessageID: sentMessage.messageID };

};

       if (command.run) {

  console.log(chalk.green(`Calling run function for command: ${command.config.name}`));

  await command.run({ api, message, args, config, nexusMessage, replyManager, onReply: async (reply) => {

    await command.onReply?.({ api, message, reply, config, nexusMessage });

  }, sendMessage: async (text) => {

    const sentMessage = await api.sendMessage(text, message.threadID);

    return sentMessage;

  }, });

} else if (command.onStart) {

  console.log(chalk.green(`Calling run function for command: ${command.config.name}`));

      await command.onStart({

      api,

      message,

      args,

      config,

      nexusMessage,

      replyManager,

      onReply: async (reply) => {

        if (command.onReply) {

          await command.onReply({ api, message, reply, config, nexusMessage });

        }

      },

      sendMessage: async (text) => {

        const sentMessage = await api.sendMessage(text, message.threadID);

        return sentMessage;

      },

    });

  } else if (command.Nexus) {

  console.log(chalk.green(`Calling run function for command: ${command.config.name}`));

  await command.Nexus({ api, message, args, config, nexusMessage, replyManager, onReply: async (reply) => {

    await command.onReply?.({ api, message, reply, config, nexusMessage });

  }, sendMessage: async (text) => {

    const sentMessage = await api.sendMessage(text, message.threadID);

    return sentMessage;

  }, });

}

        if (response) {

          nexusMessage.reply(response);

        }

      } catch (error) {

        console.error(chalk.red(`Error in command "${commandName}":`), error);

        nexusMessage.reply(`Error in command "${commandName}": ${error.message}\nPlease report this error to the bot developer.`);

      }

    }, generateRandomDelay(1000, 3000));

  } catch (error) {

  nexusMessage.reply(`Error in command "${commandName}": ${error.message}\nPlease report this error to the bot developer.`);

}

}

setInterval(() => {

  replyManager.cleanupExpiredListeners();

}, 10 * 60 * 1000);