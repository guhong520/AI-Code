import readline from 'node:readline';
import chalk from 'chalk';

const MAX_VISIBLE = 8;

/**
 * @typedef {{ label: string, value: string, description?: string }} SuggestItem
 * @typedef {'slash' | 'at' | 'hash' | null} SuggestMode
 */

/**
 * 检测行首 slash 指令 token（整行以 / 开头且第一个词内无空格问题由 token 界定）
 * @param {string} line
 * @param {number} cursor
 * @returns {{ mode: 'slash', prefix: string, start: number, end: number } | null}
 */
function detectSlash(line, cursor) {
  if (!line.startsWith('/')) {
    return null;
  }
  // 仅行首：第一个空白前的片段
  const spaceIdx = line.indexOf(' ');
  const tokenEnd = spaceIdx === -1 ? line.length : spaceIdx;
  // 光标必须在该 token 内（含末尾）才展示列表
  if (cursor > tokenEnd) {
    return null;
  }
  return {
    mode: 'slash',
    prefix: line.slice(0, tokenEnd),
    start: 0,
    end: tokenEnd,
  };
}

/**
 * 检测光标处的 @token
 * @param {string} line
 * @param {number} cursor
 * @returns {{ mode: 'at', prefix: string, start: number, end: number } | null}
 * 必须得前后有空格或行首行尾，才能算是 token
 */
function detectAt(line, cursor) {
  // 从光标向左找 token 起点
  let start = cursor;
  while (start > 0 && !/\s/.test(line[start - 1])) {
    start -= 1;
  }
  let end = cursor;
  while (end < line.length && !/\s/.test(line[end])) {
    end += 1;
  }
  const token = line.slice(start, end);
  if (!token.startsWith('@')) {
    return null;
  }
  return {
    mode: 'at',
    prefix: token.slice(1),
    start,
    end,
  };
}

/**
 * 检测光标处的 #token（设计图）
 * @param {string} line
 * @param {number} cursor
 * @returns {{ mode: 'hash', prefix: string, start: number, end: number } | null}
 */
function detectHash(line, cursor) {
  let start = cursor;
  while (start > 0 && !/\s/.test(line[start - 1])) {
    start -= 1;
  }
  let end = cursor;
  while (end < line.length && !/\s/.test(line[end])) {
    end += 1;
  }
  const token = line.slice(start, end);
  if (!token.startsWith('#')) {
    return null;
  }
  return {
    mode: 'hash',
    prefix: token.slice(1),
    start,
    end,
  };
}

/**
 * @param {string} line
 * @param {number} cursor
 */
function detectSuggest(line, cursor) {
  // slash 优先（行首）
  const slash = detectSlash(line, cursor);
  if (slash) return slash;
  const at = detectAt(line, cursor);
  if (at) return at;
  return detectHash(line, cursor);
}

/**
 * 带 /、@ 与 # 建议列表的交互式行输入
 * @param {{
 *   prompt?: string,
 *   getSlashItems?: (prefix: string) => SuggestItem[] | Promise<SuggestItem[]>,
 *   getAtItems?: (prefix: string) => SuggestItem[] | Promise<SuggestItem[]>,
 *   getHashItems?: (prefix: string) => SuggestItem[] | Promise<SuggestItem[]>,
 * }} [options]
 * @returns {Promise<string>}
 */
export function askWithSuggest(options = {}) {
  const prompt =
    options.prompt ?? chalk.bold.green('你') + chalk.gray(' › ');
  const getSlashItems = options.getSlashItems || (() => []);
  const getAtItems = options.getAtItems || (() => []);
  const getHashItems = options.getHashItems || (() => []);

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      // 非 TTY 回退：读一行
      const rl = readline.createInterface({ input: stdin, output: stdout });
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(String(answer || '').trim());
      });
      return;
    }
    //开启原始模式，监听按键事件
    readline.emitKeypressEvents(stdin);
    //记录当前模式
    const wasRaw = stdin.isRaw;
    //开启原始模式，如果不开启，终端无法捕获单独的方向键、退格；开启后，按键事件会直接发送到程序，而不是由终端处理
    stdin.setRawMode(true);
    stdin.resume();

    /** @type {string[]} */
    let chars = [];
    let cursor = 0;
    /** @type {SuggestItem[]} */
    let items = [];
    let selected = 0;
    let suggestRows = 0;
    let closed = false;
    let refreshGen = 0;
    let lastPrefixKey = '';

    function cleanup() {
      if (closed) return;
      closed = true;
      stdin.removeListener('keypress', onKeypress);
      try {
        stdin.setRawMode(wasRaw);
      } catch {
        // ignore
      }
    }

    function clearSuggest() {
      if (suggestRows <= 0) return;
      // 光标已在输入行：向下清建议区
      for (let i = 0; i < suggestRows; i++) {
        stdout.write('\n');
        stdout.write('\x1b[2K');
      }
      stdout.write(`\x1b[${suggestRows}A`);
      suggestRows = 0;
    }

    function renderLine() {
      const line = chars.join('');
      // 回到行首、清行、重绘 prompt + 内容，再移到光标
      stdout.write('\r\x1b[2K');
      stdout.write(prompt);
      stdout.write(line);
      // 终端列位置按显示宽度计算（CJK 等宽字符为 2），不能用 String.length
      const before = chars.slice(0, cursor).join('');
      const col = stringWidth(prompt) + stringWidth(before) + 1;
      stdout.write(`\r\x1b[${col}G`);
    }

    async function refreshSuggest() {
      const gen = ++refreshGen;
      const line = chars.join('');
      const ctx = detectSuggest(line, cursor);

      if (!ctx) {
        if (gen !== refreshGen) return;
        clearSuggest();
        items = [];
        selected = 0;
        lastPrefixKey = '';
        renderLine();
        return;
      }

      const prefixKey = `${ctx.mode}:${ctx.prefix}`;
      let nextItems;
      try {
        if (ctx.mode === 'slash') {
          nextItems = await Promise.resolve(getSlashItems(ctx.prefix));
        } else if (ctx.mode === 'at') {
          nextItems = await Promise.resolve(getAtItems(ctx.prefix));
        } else {
          nextItems = await Promise.resolve(getHashItems(ctx.prefix));
        }
      } catch {
        nextItems = [];
      }

      if (gen !== refreshGen || closed) return;

      items = Array.isArray(nextItems) ? nextItems : [];
      if (prefixKey !== lastPrefixKey) {
        selected = 0;
        lastPrefixKey = prefixKey;
      }
      if (selected >= items.length) {
        selected = Math.max(0, items.length - 1);
      }

      clearSuggest();
      renderLine();
      drawSuggest(ctx.mode);
    }

    /**
     * @param {'slash' | 'at' | 'hash'} mode
     */
    function drawSuggest(mode) {
      if (!items.length) {
        if (mode === 'hash') {
          suggestRows = 2;
          stdout.write('\n');
          stdout.write(
            '\x1b[2K' +
              chalk.gray('  将 png/jpg/gif/webp 放到 .front/design 后可用 # 选择'),
          );
          stdout.write('\n\x1b[2K');
          stdout.write(chalk.gray('  （当前暂无设计图）'));
          stdout.write(`\x1b[${suggestRows}A`);
          renderLine();
          return;
        }
        suggestRows = 0;
        return;
      }

      const visible = items.slice(0, MAX_VISIBLE);
      const extra = items.length > MAX_VISIBLE ? 1 : 0;
      suggestRows = visible.length + extra + 1; // +1 hint

      stdout.write('\n');
      const hint =
        mode === 'slash'
          ? chalk.gray('  ↑↓ 选择  Tab 确认  继续输入筛选')
          : mode === 'at'
            ? chalk.gray('  ↑↓ 选择  Tab 填入文件  继续输入筛选')
            : chalk.gray('  ↑↓ 选择  Tab 填入设计图  继续输入筛选');
      stdout.write('\x1b[2K' + hint);

      visible.forEach((item, i) => {
        stdout.write('\n\x1b[2K');
        const active = i === selected;
        const mark = active ? chalk.cyan('❯ ') : '  ';
        const label = active ? chalk.cyan.bold(item.label) : item.label;
        const desc = item.description
          ? chalk.gray(`  ${item.description}`)
          : '';
        stdout.write(mark + label + desc);
      });

      if (extra) {
        stdout.write('\n\x1b[2K');
        stdout.write(chalk.gray(`  …另有 ${items.length - MAX_VISIBLE} 项`));
      }

      // 光标移回输入行
      stdout.write(`\x1b[${suggestRows}A`);
      renderLine();
    }

    function applySelection() {
      if (!items.length) return;
      const line = chars.join('');
      const ctx = detectSuggest(line, cursor);
      if (!ctx) return;

      const item = items[selected];
      const insert =
        ctx.mode === 'slash'
          ? item.value
          : ctx.mode === 'at'
            ? `@${item.value}`
            : `#${item.value} `;

      const before = line.slice(0, ctx.start);
      const after = line.slice(ctx.end);
      const next = before + insert + after;
      chars = [...next];
      cursor = before.length + insert.length;
      items = [];
      selected = 0;
      clearSuggest();
      renderLine();
    }

    function finish(value) {
      clearSuggest();
      stdout.write('\n');
      cleanup();
      resolve(value);
    }

    /**
     * @param {string} _str
     * @param {{ name?: string, ctrl?: boolean, meta?: boolean, sequence?: string }} key
     */
    function onKeypress(_str, key) {
      if (closed || !key) return;

      if (key.ctrl && key.name === 'c') {
        clearSuggest();
        stdout.write('\n');
        cleanup();
        // 交给上层 SIGINT / 或抛出中断
        const err = new Error('SIGINT');
        err.code = 'SIGINT';
        reject(err);
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        const value = chars.join('').trim();
        finish(value);
        return;
      }

      if (key.name === 'tab') {
        if (items.length) {
          applySelection();
          // Tab 填入后重新刷新（slash 填完通常无列表；at / hash 可能继续）
          void refreshSuggest();
        }
        return;
      }

      if (key.name === 'up' || key.name === 'down') {
        if (items.length) {
          const maxIdx = Math.min(items.length, MAX_VISIBLE) - 1;
          if (key.name === 'up') {
            selected = selected <= 0 ? maxIdx : selected - 1;
          } else {
            selected = selected >= maxIdx ? 0 : selected + 1;
          }
          const line = chars.join('');
          const ctx = detectSuggest(line, cursor);
          clearSuggest();
          renderLine();
          if (ctx) drawSuggest(ctx.mode);
        }
        return;
      }

      if (key.name === 'left') {
        if (cursor > 0) {
          cursor -= 1;
          void refreshSuggest();
        }
        return;
      }

      if (key.name === 'right') {
        if (cursor < chars.length) {
          cursor += 1;
          void refreshSuggest();
        }
        return;
      }

      if (key.name === 'backspace') {
        if (cursor > 0) {
          chars.splice(cursor - 1, 1);
          cursor -= 1;
          void refreshSuggest();
        }
        return;
      }

      if (key.name === 'delete') {
        if (cursor < chars.length) {
          chars.splice(cursor, 1);
          void refreshSuggest();
        }
        return;
      }

      // 可打印字符
      const ch = key.sequence;
      if (ch && ch.length === 1 && !key.ctrl && !key.meta && ch >= ' ') {
        chars.splice(cursor, 0, ch);
        cursor += 1;
        void refreshSuggest();
      }
    }

    stdout.write(prompt);
    stdin.on('keypress', onKeypress);
  });
}

/** 去掉 ANSI 转义，用于计算可见文本 */
function stripAnsi(str) {
  return String(str)
    // OSC 序列（如超链接）
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    // CSI 序列
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // 字符集切换等
    .replace(/\u001b[()][0-9A-Za-z]/g, '');
}

/**
 * 单个码点的终端显示列宽（东亚宽字符按 2 列）
 * @param {number} code
 * @returns {number}
 */
function codePointWidth(code) {
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
    return 0;
  }
  // 常见宽字符区间：CJK、全角、韩文音节等
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2fffd) ||
    (code >= 0x30000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/**
 * 字符串在终端中的显示列宽（先去 ANSI）
 * @param {string} str
 * @returns {number}
 */
function stringWidth(str) {
  const plain = stripAnsi(str);
  let width = 0;
  for (const ch of plain) {
    width += codePointWidth(ch.codePointAt(0) || 0);
  }
  return width;
}
