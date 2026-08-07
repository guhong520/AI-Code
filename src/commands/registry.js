/**
 * 内置斜杠命令注册表（补全列表与 handleCommand / help 共用）
 * @typedef {{ name: string, description: string, aliases?: string[] }} CommandItem
 */

/** @type {CommandItem[]} */
export const COMMANDS = [
  { name: '/help', description: '显示帮助' },
  { name: '/clear', description: '清空对话记录' },
  { name: '/exit', description: '退出程序', aliases: ['/quit'] },
];

/**
 * 按前缀过滤命令（大小写不敏感）
 * @param {string} prefix 含前导 / 的前缀，如 "/" 或 "/hel"
 * @returns {CommandItem[]}
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
  const cmd = String(input || '').trim().toLowerCase();
  for (const item of COMMANDS) {
    if (item.name.toLowerCase() === cmd) {
      return item.name;
    }
    if ((item.aliases || []).some((a) => a.toLowerCase() === cmd)) {
      return item.name;
    }
  }
  // 兼容无斜杠的 exit / quit
  if (cmd === 'exit' || cmd === 'quit') {
    return '/exit';
  }
  return null;
}
