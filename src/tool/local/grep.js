import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getProjectRoot, listProjectFiles } from '../../utils/projectFiles.js';
import { matchGlob } from './glob.js';

/** 单文件最大读取字节，过大跳过 */
const MAX_FILE_BYTES = 1.5 * 1024 * 1024;

/** 全局最多返回的匹配行数 */
const MAX_MATCHES = 80;

/** 单行展示最大字符 */
const MAX_LINE_CHARS = 240;

/**
 * 粗判二进制：抽样区含 NUL 则视为二进制
 * @param {Buffer} buf
 * @returns {boolean}
 */
function isBinaryBuffer(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function clipLine(text, max = MAX_LINE_CHARS) {
  const s = String(text ?? '').replace(/\t/g, '  ');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * 编译搜索模式
 * @param {string} pattern
 * @param {{ regex?: boolean, caseInsensitive?: boolean }} options
 * @returns {{ ok: true, re: RegExp } | { ok: false, error: string }}
 */
function compilePattern(pattern, options) {
  const flags = options.caseInsensitive ? 'gi' : 'g';
  try {
    if (options.regex) {
      return { ok: true, re: new RegExp(pattern, flags) };
    }
    // 字面量：转义正则特殊字符
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { ok: true, re: new RegExp(escaped, flags) };
  } catch (err) {
    return {
      ok: false,
      error: `无效的正则：${err?.message || String(err)}`,
    };
  }
}

/**
 * 在当前项目中搜索文件内容
 * @param {{
 *   pattern?: string,
 *   glob?: string,
 *   regex?: boolean,
 *   case_insensitive?: boolean,
 *   path?: string,
 * }} args
 * @returns {Promise<string>}
 */
async function runGrep(args = {}) {
  const pattern = String(args.pattern ?? '');
  if (!pattern) {
    return 'grep 失败：pattern 不能为空';
  }

  const fileGlob = String(args.glob ?? '').trim();
  const pathPrefix = String(args.path ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const useRegex = args.regex !== false && args.regex !== 'false';
  const caseInsensitive =
    args.case_insensitive === true || args.case_insensitive === 'true';

  const compiled = compilePattern(pattern, {
    regex: useRegex,
    caseInsensitive,
  });
  if (!compiled.ok) {
    return `grep 失败：${compiled.error}`;
  }

  const root = await getProjectRoot();
  let files = await listProjectFiles({ refresh: true });

  if (pathPrefix) {
    const prefix = pathPrefix.endsWith('/') ? pathPrefix : `${pathPrefix}/`;
    files = files.filter((f) => f === pathPrefix || f.startsWith(prefix));
  }

  if (fileGlob) {
    files = files.filter((f) => matchGlob(fileGlob, f));
  }

  /** @type {string[]} */
  const hits = [];
  let filesWithHits = 0;
  let scanned = 0;
  let skippedBinary = 0;
  let skippedLarge = 0;

  for (const rel of files) {
    if (hits.length >= MAX_MATCHES) break;

    const abs = join(root, rel);
    let buf;
    try {
      buf = await readFile(abs);
    } catch {
      continue;
    }

    scanned += 1;

    if (buf.length > MAX_FILE_BYTES) {
      skippedLarge += 1;
      continue;
    }
    if (isBinaryBuffer(buf)) {
      skippedBinary += 1;
      continue;
    }

    let text;
    try {
      text = buf.toString('utf8');
    } catch {
      skippedBinary += 1;
      continue;
    }

    const lines = text.split(/\r?\n/);
    let fileHit = false;

    for (let i = 0; i < lines.length; i += 1) {
      if (hits.length >= MAX_MATCHES) break;
      const line = lines[i];
      compiled.re.lastIndex = 0;
      if (!compiled.re.test(line)) continue;
      fileHit = true;
      hits.push(`${rel}:${i + 1}:${clipLine(line)}`);
    }

    if (fileHit) filesWithHits += 1;
  }

  const header = [
    `pattern: ${pattern}`,
    `mode: ${useRegex ? 'regex' : 'literal'}`,
    caseInsensitive ? 'case: insensitive' : 'case: sensitive',
    fileGlob ? `glob: ${fileGlob}` : null,
    pathPrefix ? `path: ${pathPrefix}` : null,
    `root: ${root}`,
    `scanned_files: ${scanned}`,
    `files_with_matches: ${filesWithHits}`,
    `matches: ${hits.length}${hits.length >= MAX_MATCHES ? `（已截断，最多 ${MAX_MATCHES} 条）` : ''}`,
    skippedBinary ? `skipped_binary: ${skippedBinary}` : null,
    skippedLarge ? `skipped_large: ${skippedLarge}` : null,
    '---',
  ].filter(Boolean);

  if (hits.length === 0) {
    return `${header.join('\n')}\n(无匹配)`;
  }

  return `${header.join('\n')}\n${hits.join('\n')}`;
}

export const toolList = [
  {
    type: 'function',
    function: {
      name: 'grep',
      description:
        '在当前项目中全局搜索文件内容（纯 Node.js，跨 Windows/macOS/Linux）。支持正则或字符串匹配，可用 glob 过滤文件类型；自动跳过 node_modules、.git、二进制及过大文件。本工具只用于搜索相关代码；需要搜索时必须使用此工具，不要自行用 bash（含 findstr/rg/grep）解决。',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: '搜索内容：正则表达式，或在 regex=false 时的普通字符串',
          },
          glob: {
            type: 'string',
            description: "可选。仅搜索匹配该 glob 的文件，如 '*.js'、'src/**/*.ts'",
          },
          regex: {
            type: 'boolean',
            description: '是否将 pattern 视为正则，默认 true；false 则为字面量匹配',
          },
          case_insensitive: {
            type: 'boolean',
            description: '是否忽略大小写，默认 false',
          },
          path: {
            type: 'string',
            description: '可选。限制在项目内相对目录下搜索，如 src 或 src/tool',
          },
        },
        required: ['pattern'],
      },
    },
  },
];

export const toolMap = {
  grep: runGrep,
};
