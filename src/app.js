import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  clearScreen,
  printBanner,
  printAssistant,
  printSystem,
  createInterface,
  ask,
} from './utils/terminal.js';
import { chatCompletion, hasApiKey, getModel } from './request/openai.js';
import { saveHistoryJson } from './utils/fsHandle.js';
import { COMMANDS, matchCommand } from './commands/registry.js';
import { buildUserContent } from './utils/mentions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// 始终从项目根目录加载 .env，避免 cwd 不同导致读不到密钥
dotenv.config({ path: join(rootDir, '.env'), quiet: true });

/** 对话历史（不含 system） */
const history = [];

/** 是否正在退出，避免重复保存/退出 */
let exiting = false;

/** 系统提示词（启动时加载） */
let systemPrompt = '你是一个有用的 AI 编程助手。';

async function loadSystemPrompt() {
  try {
    const path = join(__dirname, 'docs', 'system.md');
    systemPrompt = (await readFile(path, 'utf8')).trim();
  } catch {
    // 使用默认 systemPrompt
  }
}

/** 保存对话历史后退出 */
async function exitApp(rl, message = '再见，下次继续～') {
  if (exiting) {
    return;
  }
  exiting = true;

  try {
    if (history.length > 0) {
      const filePath = await saveHistoryJson(history);
      printSystem(chalk.gray(`对话已保存：${filePath}`));
    }
  } catch (err) {
    printSystem(chalk.red(`保存对话失败：${err.message}`));
  }

  if (message) {
    printSystem(message);
  }

  // 避免 rl.close 再次触发退出逻辑
  rl.removeAllListeners('close');
  rl.close();
  process.exit(0);
}

/** 内置命令处理，返回 true 表示已消费该输入 */
async function handleCommand(input, rl) {
  const matched = matchCommand(input);
  if (!matched) {
    return false;
  }

  if (matched === '/exit') {
    await exitApp(rl);
    return true;
  }

  if (matched === '/clear') {
    history.length = 0;
    clearScreen();
    printBanner();
    printSystem('对话记录已清空');
    return true;
  }

  if (matched === '/help') {
    console.log();
    printSystem('可用命令：');
    for (const cmd of COMMANDS) {
      const alias =
        cmd.aliases && cmd.aliases.length
          ? chalk.gray(`（${cmd.aliases.join(', ')}）`)
          : '';
      printSystem(`${cmd.name.padEnd(8)} ${cmd.description}${alias}`);
    }
    console.log();
    printSystem('提示：行首输入 / 可上下选择指令，Tab 确认');
    printSystem('提示：输入 @ 可选择项目文件，内容会作为上下文发给模型');
    console.log();
    return true;
  }

  return false;
}

/**
 * 将用户问题发给大模型并返回回复
 * @param {string} userInput 已增强（含 @ 文件内容）的消息
 * @returns {Promise<string>}
 */
async function reply(userInput) {
  history.push({ role: 'user', content: userInput });

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  try {
    const assistantText = await chatCompletion(messages);
    history.push({ role: 'assistant', content: assistantText });
    return assistantText;
  } catch (err) {
    // 请求失败时回滚本轮用户消息，避免污染后续上下文
    history.pop();
    throw err;
  }
}

/** 主对话循环 */
async function chatLoop(rl) {
  while (true) {
    let input;
    try {
      input = await ask(rl);
    } catch (err) {
      if (err && err.code === 'SIGINT') {
        console.log();
        printSystem('已中断，退出中…');
        await exitApp(rl, '');
        return;
      }
      throw err;
    }

    if (!input) {
      continue;
    }

    const handled = await handleCommand(input, rl);
    if (handled) {
      continue;
    }

    const spinner = ora({
      text: chalk.gray('思考中…'),
      color: 'cyan',
    }).start();

    try {
      const content = await buildUserContent(input, {
        onWarn: (msg) => {
          spinner.stop();
          printSystem(chalk.yellow(msg));
          spinner.start();
        },
      });
      const answer = await reply(content);
      spinner.stop();
      printAssistant(answer);
    } catch (err) {
      spinner.fail(chalk.red(`请求失败：${err.message}`));
    }
  }
}

async function main() {
  await loadSystemPrompt();

  clearScreen();
  printBanner();

  if (!hasApiKey()) {
    printSystem(chalk.yellow('警告：未检测到 OPENAI_API_KEY'));
    printSystem(chalk.yellow('请复制 .env.example 为 .env 并填入密钥后再提问'));
    console.log();
  } else {
    printSystem(chalk.gray(`模型：${getModel()}`));
    console.log();
  }

  const rl = createInterface();

  rl.on('close', () => {
    exitApp(rl, '').catch(() => process.exit(0));
  });

  process.on('SIGINT', () => {
    console.log();
    printSystem('已中断，退出中…');
    exitApp(rl, '').catch(() => process.exit(0));
  });

  await chatLoop(rl);
}

main().catch((err) => {
  console.error(chalk.red('启动失败：'), err);
  process.exit(1);
});
