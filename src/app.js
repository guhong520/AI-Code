import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';
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
import { COMMANDS, parseCommand, reloadCommands } from './commands/registry.js';
import { buildUserContent } from './utils/mentions.js';
import { readSystem, getUserContext, getSkillHeaders } from './utils/contextRead.js';
import {
  loadTools,
  toOpenAiTools,
  excuteTool,
  parseToolArguments,
  toolResultToText,
} from './tool/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

/** 单轮对话内最多允许的 tool 调用轮次，防止死循环 */
const MAX_TOOL_ROUNDS = 8;

// 始终从项目根目录加载 .env，避免 cwd 不同导致读不到密钥
dotenv.config({ path: join(rootDir, '.env'), quiet: true });

/** 对话历史（不含 system / 本地用户上下文 / skill 摘要；含 tool_calls 与 tool 结果） */
const history = [];

/** 是否正在退出，避免重复保存/退出 */
let exiting = false;

/** 系统提示词（启动时 readSystem 加载一次，仅请求时注入） */
let systemPrompt = '你是一个有用的 AI 编程助手。';

/** 本地用户/项目上下文（启动时 getUserContext 加载一次，仅请求时以 user 注入） */
let userContext = '';

/** Skill 调度上下文（启动时 getSkillHeaders 加载一次，仅请求时以 user 注入，不写入 history） */
let skillContext = '';

/** OpenAI function tools（启动时 loadTools 加载一次） */
let openAiTools = [];

/** 工具加载失败时的提示（启动横幅后再打印） */
let toolsLoadError = '';

/** 启动时读取 FrontSystem / front.md / skills / tools 等，会话内复用，不每次请求重读 */
async function loadContextPrompts() {
  try {
    systemPrompt = await readSystem();
  } catch {
    // 使用默认 systemPrompt
  }
  try {
    userContext = await getUserContext();
  } catch {
    userContext = '';
  }
  try {
    skillContext = await getSkillHeaders();
  } catch {
    skillContext = '';
  }
  try {
    const { toolList } = await loadTools();
    openAiTools = toOpenAiTools(toolList);
    toolsLoadError = '';
  } catch (err) {
    openAiTools = [];
    toolsLoadError = err?.message || String(err);
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

/**
 * 将非阻断指令返回的上下文字符串与用户文本合并，供发给大模型
 * @param {string} userText
 * @param {string} context
 * @returns {string}
 */
function mergeCommandContext(userText, context) {
  const text = String(userText || '').trim();
  const ctx = String(context || '').trim();
  if (text && ctx) {
    return `${text}\n\n${ctx}`;
  }
  return text || ctx;
}

/**
 * 内置命令处理
 * - type: 'none'        未匹配指令，走普通对话
 * - type: 'blocking'    阻断类：已执行，不再请求大模型
 * - type: 'passthrough' 非阻断类：已执行，携带 context + userText 继续请求大模型
 *
 * @param {string} input
 * @param {ReturnType<typeof createInterface>} rl
 * @returns {Promise<
 *   | { type: 'none' }
 *   | { type: 'blocking' }
 *   | { type: 'passthrough', context: string, userText: string }
 * >}
 */
async function handleCommand(input, rl) {
  const parsed = parseCommand(input);
  if (!parsed) {
    return { type: 'none' };
  }

  const { args, item } = parsed;
  if (typeof item.run !== 'function') {
    printSystem(chalk.yellow(`指令 ${item.name} 暂未实现`));
    return { type: 'blocking' };
  }

  return item.run({
    args,
    rl,
    history,
    exitApp,
    commands: COMMANDS,
  });
}

/**
 * 执行模型返回的一组 tool_calls，并把 role=tool 结果追加到 messages 与 history
 * @param {any[]} toolCalls
 * @param {any[]} messages
 * @param {{ text?: (s: string) => void }} [spinner]
 */
async function runToolCalls(toolCalls, messages, spinner) {
  for (const call of toolCalls) {
    const name = call?.function?.name || call?.name || '';
    const args = parseToolArguments(call?.function?.arguments ?? call?.arguments);
    const callId = call?.id || `call_${name || 'unknown'}`;

    if (spinner) {
      spinner.text = chalk.gray(`调用工具 ${name || 'unknown'}…`);
    }

    let content;
    try {
      const result = await excuteTool(name, args);
      content = toolResultToText(result);
    } catch (err) {
      content = `工具执行失败：${err?.message || String(err)}`;
    }

    const toolMessage = {
      role: 'tool',
      tool_call_id: callId,
      content: content || '',
    };
    messages.push(toolMessage);
    history.push(toolMessage);
  }
}

/**
 * 将用户问题发给大模型并返回回复（支持 function tool 多轮调用）
 * @param {string} userInput 已增强（含 @ 文件内容）的消息
 * @param {{ text?: (s: string) => void }} [spinner]
 * @returns {Promise<string>}
 */
async function reply(userInput, spinner) {
  const historyCheckpoint = history.length;
  history.push({ role: 'user', content: userInput });

  // system / 本地 user / skill 上下文仅拼进本次请求，不写入 history
  const messages = [{ role: 'system', content: systemPrompt }];
  if (userContext.trim()) {
    messages.push({ role: 'user', content: userContext });
  }
  if (skillContext.trim()) {
    messages.push({ role: 'user', content: skillContext });
  }
  messages.push(...history);

  try {
    let assistantText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (spinner) {
        spinner.text = chalk.gray(round === 0 ? '思考中…' : '继续思考…');
      }

      const message = await chatCompletion(messages, { tools: openAiTools });
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

      // 必须把完整 assistant message（含 tool_calls）回传，否则下一轮 API 会报错
      const assistantMessage = {
        role: 'assistant',
        content: message.content ?? null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
      messages.push(assistantMessage);

      if (toolCalls.length === 0) {
        assistantText = String(message.content || '').trim();
        if (!assistantText) {
          throw new Error('大模型未返回有效内容');
        }
        history.push({ role: 'assistant', content: assistantText });
        return assistantText;
      }

      // 含 tool_calls 的中间轮也写入 history，供后续多轮与落盘复用
      history.push(assistantMessage);
      await runToolCalls(toolCalls, messages, spinner);
    }

    throw new Error(`工具调用超过 ${MAX_TOOL_ROUNDS} 轮，已中止`);
  } catch (err) {
    // 请求失败时回滚本轮写入的 user / tool_calls / tool 结果
    history.length = historyCheckpoint;
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

    const cmdResult = await handleCommand(input, rl);
    if (cmdResult.type === 'blocking') {
      continue;
    }

    // 非阻断指令：用命令参数作为用户文本；普通输入：整行作为用户文本
    const userText =
      cmdResult.type === 'passthrough' ? cmdResult.userText : input;
    const commandContext =
      cmdResult.type === 'passthrough' ? cmdResult.context : '';

    // 非阻断且无用户文本、无上下文时，无需请求大模型
    if (cmdResult.type === 'passthrough' && !userText.trim() && !commandContext.trim()) {
      continue;
    }

    const spinner = ora({
      text: chalk.gray('思考中…'),
      color: 'cyan',
    }).start();

    try {
      const baseContent = await buildUserContent(userText, {
        onWarn: (msg) => {
          spinner.stop();
          printSystem(chalk.yellow(msg));
          spinner.start();
        },
      });
      const content = mergeCommandContext(baseContent, commandContext);
      if (!content.trim()) {
        spinner.stop();
        continue;
      }
      const answer = await reply(content, spinner);
      spinner.stop();
      printAssistant(answer);
    } catch (err) {
      spinner.fail(chalk.red(`请求失败：${err.message}`));
    }
  }
}

async function main() {
  // 启动时加载一次 system / 用户 / skill / tools，后续请求复用缓存，不写入对话历史
  await loadContextPrompts();
  // 扫描 ~/.front/commands 与项目 .front/commands，合并自定义指令
  await reloadCommands();

  clearScreen();
  printBanner();

  if (!hasApiKey()) {
    printSystem(chalk.yellow('警告：未检测到 OPENAI_API_KEY'));
    printSystem(chalk.yellow('请复制 .env.example 为 .env 并填入密钥后再提问'));
    console.log();
  } else {
    printSystem(chalk.gray(`模型：${getModel()}`));
    if (toolsLoadError) {
      printSystem(chalk.yellow(`工具加载失败：${toolsLoadError}`));
    } else if (openAiTools.length > 0) {
      printSystem(
        chalk.gray(
          `工具：${openAiTools.length} 个（${openAiTools.map((t) => t.function.name).join(', ')}）`,
        ),
      );
    } else {
      printSystem(chalk.gray('工具：未加载到可用 function tool'));
    }
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
