import help from './systemCommands/help.js';
import clear from './systemCommands/clear.js';
import exit from './systemCommands/exit.js';
import project from './systemCommands/project.js';
import { loadCustomCommands } from './loadCustom.js';

/**
 * 内置斜杠命令注册表（补全列表与 handleCommand / help 共用）
 *
 * blocking:
 *   - true  阻断类：执行后不请求大模型
 *   - false 非阻断类：执行后返回上下文字符串，与用户文本一并发给大模型
 *
 * @typedef {{
 *   args: string,
 *   rl: import('node:readline').Interface,
 *   history: Array<{ role: string, content: string }>,
 *   exitApp: (rl: import('node:readline').Interface, message?: string) => Promise<void>,
 *   commands: CommandDef[],
 * }} CommandContext
 *
 * @typedef {{
 *   name: string,
 *   description: string,
 *   blocking: boolean,
 *   aliases?: string[],
 *   run: (ctx: CommandContext) => Promise<
 *     | { type: 'blocking' }
 *     | { type: 'passthrough', context: string, userText: string }
 *   >,
 * }} CommandDef
 */

/** @type {CommandDef[]} */
export const BUILTIN_COMMANDS = [help, clear, exit, project];

/**
 * 当前生效的命令列表（内置 + 自定义）。启动时由 reloadCommands 填充。
 * @type {CommandDef[]}
 */
export let COMMANDS = [...BUILTIN_COMMANDS];

/**
 * 重新扫描用户/项目 .front/commands，合并进注册表。
 * 同名时：内置 > 项目自定义 > 用户自定义。
 * @returns {Promise<CommandDef[]>}
 */
export async function reloadCommands() {
  const custom = await loadCustomCommands();
  const builtinNames = new Set(
    BUILTIN_COMMANDS.map((c) => c.name.toLowerCase()),
  );

  const customOnly = custom.filter(
    (c) => !builtinNames.has(c.name.toLowerCase()),
  );

  COMMANDS = [...BUILTIN_COMMANDS, ...customOnly];
  return COMMANDS;
}

/**
 * 按主命令名或别名查找命令项
 * @param {string} token
 * @returns {CommandDef | null}
 */
export function findCommand(token) {
  const cmd = String(token || '').trim().toLowerCase();
  if (!cmd) {
    return null;
  }

  for (const item of COMMANDS) {
    if (item.name.toLowerCase() === cmd) {
      return item;
    }
    if ((item.aliases || []).some((a) => a.toLowerCase() === cmd)) {
      return item;
    }
  }

  // 兼容无斜杠的 exit / quit
  if (cmd === 'exit' || cmd === 'quit') {
    return COMMANDS.find((c) => c.name === '/exit') || null;
  }

  return null;
}

/**
 * 解析输入中的斜杠指令：取首词为命令，其余为参数/用户文本
 * @param {string} input
 * @returns {{ name: string, args: string, item: CommandDef } | null}
 */
export function parseCommand(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    return null;
  }

  // 整行 exit / quit（无斜杠）
  if (/^(exit|quit)$/i.test(trimmed)) {
    const item = findCommand(trimmed);
    if (!item) {
      return null;
    }
    return { name: item.name, args: '', item };
  }

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const spaceIdx = trimmed.search(/\s/);
  const token = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx).trim();
  const item = findCommand(token);
  if (!item) {
    return null;
  }

  return { name: item.name, args, item };
}

/**
 * 按前缀过滤命令（大小写不敏感）
 * @param {string} prefix 含前导 / 的前缀，如 "/" 或 "/hel" 或 "/a:"
 * @returns {CommandDef[]}
 */
export function filterCommands(prefix) {
  const p = String(prefix || '').toLowerCase();
  if (!p.startsWith('/')) {
    return [];
  }
  return COMMANDS.filter((cmd) => {
    if (cmd.name.toLowerCase().startsWith(p)) {
      return true;
    }
    return (cmd.aliases || []).some((a) => a.toLowerCase().startsWith(p));
  });
}

/**
 * 判断输入是否匹配某个已注册命令（含别名）
 * @param {string} input
 * @returns {string | null} 规范化后的主命令名，未匹配返回 null
 */
export function matchCommand(input) {
  const parsed = parseCommand(input);
  return parsed ? parsed.name : null;
}
