import { debugPage } from '../../utils/debuggerUtils.js';

/** 返回给模型的 console 条数上限 */
const MAX_CONSOLE_LINES = 40;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number | undefined}
 */
function toOptionalInt(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function toBool(value) {
  if (typeof value === 'boolean') return value;
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/**
 * @param {{ type?: string, text?: string, source?: string, line?: number }} entry
 * @param {number} index
 * @returns {string}
 */
function formatEntry(entry, index) {
  const loc =
    entry.source && Number.isFinite(entry.line)
      ? ` @ ${entry.source}:${entry.line}`
      : entry.source
        ? ` @ ${entry.source}`
        : '';
  return `${index + 1}. [${entry.type || 'log'}] ${entry.text || ''}${loc}`;
}

/**
 * 用无头 Chromium 打开页面：有 console 报错则立刻返回错误；否则截图并返回路径
 * @param {{
 *   url?: string,
 *   wait_ms?: number,
 *   timeout_ms?: number,
 *   width?: number,
 *   height?: number,
 *   full_page?: boolean,
 * }} args
 * @returns {Promise<string>}
 */
async function runDebuggerPage(args = {}) {
  const url = String(args.url ?? '').trim();
  if (!url) {
    return 'debugger_page 失败：url 不能为空。请提供要预览的页面地址（如 http://localhost:5173/）。';
  }

  let result;
  try {
    result = await debugPage({
      url,
      waitMs: toOptionalInt(args.wait_ms, undefined),
      timeoutMs: toOptionalInt(args.timeout_ms, undefined),
      width: toOptionalInt(args.width, undefined),
      height: toOptionalInt(args.height, undefined),
      fullPage: toBool(args.full_page),
    });
  } catch (err) {
    return `debugger_page 失败：${err?.message || String(err)}`;
  }

  if (result.hasError) {
    const errorLines = result.errors.map((e, i) => formatEntry(e, i));
    const extraConsole = result.consoleEntries
      .filter((e) => e.type !== 'error' && e.type !== 'assert')
      .slice(0, MAX_CONSOLE_LINES)
      .map((e, i) => formatEntry(e, i));

    return [
      'status: console_error',
      `url: ${result.url}`,
      result.httpStatus != null ? `http_status: ${result.httpStatus}` : null,
      '说明：页面控制台存在报错，请根据下列错误立刻修正代码，然后再次调用 debugger_page。此时不要调用 diff_pic。',
      '',
      'errors:',
      ...errorLines,
      extraConsole.length > 0 ? '' : null,
      extraConsole.length > 0 ? 'other_console:' : null,
      ...extraConsole,
    ]
      .filter((line) => line != null)
      .join('\n');
  }

  return [
    'status: ok',
    `url: ${result.url}`,
    result.httpStatus != null ? `http_status: ${result.httpStatus}` : null,
    `screenshot_path: ${result.screenshotPath}`,
    '说明：控制台无报错，页面截图已保存。请将 screenshot_path 与原始设计图绝对路径一并传给 diff_pic 做视觉比对。若当前对话没有设计图路径，请向用户索取。',
  ]
    .filter((line) => line != null)
    .join('\n');
}

export const toolList = [
  {
    type: 'function',
    function: {
      name: 'debugger_page',
      description:
        '代码写入后用于预览调试：用无头 Chromium 打开给定 URL，等待页面 load 完成并采集控制台。分支①控制台有报错：立刻返回错误文本，请据此修正代码后再次调用本工具，不要做截图对比。分支②无报错：保存页面截图并返回 screenshot_path，随后可调用 diff_pic（需同时提供原始设计图绝对路径）。url 需为可访问的 http/https 地址，尽量根据本次修改的文件与路由推断，例如 http://localhost:5173/user。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '要预览的页面完整 URL，例如 http://localhost:5173/ 或 http://127.0.0.1:8080/index.html',
          },
          wait_ms: {
            type: 'integer',
            description: '页面 load 后再额外等待的毫秒数，给 SPA 渲染时间，默认 1000',
          },
          timeout_ms: {
            type: 'integer',
            description: '打开页面超时毫秒，默认 30000',
          },
          width: {
            type: 'integer',
            description: '视口宽度，默认 1440',
          },
          height: {
            type: 'integer',
            description: '视口高度，默认 900',
          },
          full_page: {
            type: 'boolean',
            description: '是否截整页（长页面）。默认 false，只截当前视口，更接近常见设计稿',
          },
        },
        required: ['url'],
      },
    },
  },
];

export const toolMap = {
  debugger_page: runDebuggerPage,
};
