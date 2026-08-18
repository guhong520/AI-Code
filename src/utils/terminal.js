import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { askWithSuggest } from './promptInput.js';
import { filterCommands } from '../commands/registry.js';
import { filterDesignImages, filterProjectFiles, listDesignImages, listProjectFiles } from './projectFiles.js';

marked.use(
  markedTerminal({
    reflowText: true,
    width: Math.min(process.stdout.columns || 80, 100),
    showSectionPrefix: false,
    unescape: true,
    tab: 2,
  }),
);

/**
 * 将 Markdown 渲染为适合终端显示的带样式文本
 * @param {string} text
 * @returns {string}
 */
export function renderMarkdown(text) {
  if (!text) {
    return '';
  }
  try {
    return String(marked.parse(text, { async: false })).trimEnd();
  } catch {
    return text;
  }
}

/** 清空当前终端内容 */
export function clearScreen() {
  process.stdout.write('\x1Bc');
}

/** 打印启动欢迎界面 */
export function printBanner() {
  const line = chalk.cyan('═'.repeat(48));
  console.log();
  console.log(line);
  console.log(chalk.bold.cyan('  FrontCode') + chalk.gray('  ·  AI 终端开发助手'));
  console.log(line);
  console.log();
  console.log(chalk.gray('  输入消息开始对话，输入 ') + chalk.yellow('/exit') + chalk.gray(' 或 ') + chalk.yellow('/quit') + chalk.gray(' 退出'));
  console.log(chalk.gray('  行首输入 ') + chalk.yellow('/') + chalk.gray(' 可选择指令，') + chalk.yellow('@') + chalk.gray(' 可选择文件作为上下文，') + chalk.yellow('#') + chalk.gray(' 可选择 .front/design 设计图'));
  console.log(chalk.gray('  输入 ') + chalk.yellow('/clear') + chalk.gray(' 清空对话记录 · ') + chalk.yellow('/project') + chalk.gray(' 注入项目信息 · ') + chalk.yellow('/help') + chalk.gray(' 查看帮助'));
  console.log(chalk.gray('  自定义指令：') + chalk.yellow('~/.front/commands') + chalk.gray(' 或项目 ') + chalk.yellow('.front/commands') + chalk.gray('，形如 ') + chalk.yellow('/组:名'));
  console.log();
}

/** 打印用户消息 */
export function printUser(text) {
  console.log();
  console.log(chalk.bold.green('你') + chalk.gray(' › ') + text);
}

/**
 * 打印助手消息（自动解析 Markdown：标题、加粗、代码块、列表、表格等）
 * @param {string} text
 */
export function printAssistant(text) {
  console.log();
  console.log(chalk.bold.cyan('AI') + chalk.gray(' ›'));
  console.log(renderMarkdown(text));
}
/**
 * 打印系统提示
 * @param {string} text
 * @param {{ markdown?: boolean }} [options]
 */
export function printSystem(text, options = {}) {
  const content = options.markdown ? renderMarkdown(text) : text;
  if (options.markdown) {
    console.log(content);
    return;
  }
  console.log(chalk.gray(`  ${content}`));
}

/**
 * 创建会话生命周期句柄（不再占用 stdin；输入由 askWithSuggest 接管）
 * @returns {{ on: Function, removeAllListeners: Function, close: Function }}
 */
export function createInterface() {
  /** @type {Record<string, Function[]>} */
  const listeners = Object.create(null);

  return {
    on(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeAllListeners(event) {
      if (event) {
        listeners[event] = [];
      } else {
        for (const key of Object.keys(listeners)) {
          listeners[key] = [];
        }
      }
    },
    close() {
      const list = listeners.close || [];
      for (const fn of list) {
        try {
          fn();
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * 以 Promise 方式读取一行输入（支持 / 指令、@ 文件与 # 设计图建议）
 * @param {unknown} [_rl] 兼容旧签名
 * @param {string} [prompt]
 * @returns {Promise<string>}
 */
export async function ask(_rl, prompt = chalk.bold.green('你') + chalk.gray(' › ')) {
  // 预热文件列表缓存，避免首次 @ / # 卡顿
  listProjectFiles().catch(() => {});
  listDesignImages({ refresh: true }).catch(() => {});

  return askWithSuggest({
    prompt,
    getSlashItems: (prefix) =>
      filterCommands(prefix).map((cmd) => ({
        label: cmd.name,
        value: cmd.name,
        description: cmd.description,
      })),
    getAtItems: async (prefix) => {
      const files = await filterProjectFiles(prefix);
      return files.slice(0, 50).map((f) => ({
        label: f,
        value: f,
      }));
    },
    getHashItems: async (prefix) => {
      const files = await filterDesignImages(prefix);
      return files.slice(0, 50).map((f) => ({
        label: f,
        value: f,
      }));
    },
  });
}
