import { join } from 'node:path';
import { platform } from 'node:os';
import { getProjectRoot, listProjectFiles } from '../../utils/projectFiles.js';

/** 返回路径条数上限 */
const MAX_RESULTS = 500;

/**
 * 规范化 glob：无路径分隔符时视为任意深度匹配（如 *.js → ** / *.js，中间无空格）
 * @param {string} pattern
 * @returns {string}
 */
export function normalizeGlobPattern(pattern) {
  let p = String(pattern || '')
    .trim()
    .replace(/\\/g, '/');
  if (!p) return '';
  if (!p.includes('/')) {
    p = `**/${p}`;
  }
  return p;
}

/**
 * 将 glob 转为正则（支持 * ? **）
 * @param {string} pattern
 * @param {{ caseInsensitive?: boolean }} [options]
 * @returns {RegExp}
 */
export function globToRegExp(pattern, options = {}) {
  const p = normalizeGlobPattern(pattern);
  let out = '^';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        i += 1;
        if (p[i + 1] === '/') {
          i += 1;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(c)) {
      out += `\\${c}`;
      continue;
    }
    out += c;
  }
  out += '$';
  const flags = options.caseInsensitive ? 'i' : '';
  return new RegExp(out, flags);
}

/**
 * @param {string} pattern
 * @param {string} relPath
 * @returns {boolean}
 */
export function matchGlob(pattern, relPath) {
  const pathNorm = String(relPath || '').replace(/\\/g, '/');
  const caseInsensitive = platform() === 'win32';
  try {
    return globToRegExp(pattern, { caseInsensitive }).test(pathNorm);
  } catch {
    return false;
  }
}

/**
 * 根据 glob 模式查找项目内文件
 * @param {{ pattern?: string }} args
 * @returns {Promise<string>}
 */
async function runGlob({ pattern } = {}) {
  const pat = String(pattern ?? '').trim();
  if (!pat) {
    return 'glob 失败：pattern 不能为空';
  }

  const root = await getProjectRoot();
  const files = await listProjectFiles({ refresh: true });
  const matched = files.filter((f) => matchGlob(pat, f));

  const shown = matched.slice(0, MAX_RESULTS);
  const absPaths = shown.map((f) => join(root, f).replace(/\\/g, '/'));

  const lines = [
    `pattern: ${pat}`,
    `root: ${root}`,
    `matched: ${matched.length}`,
    matched.length > MAX_RESULTS
      ? `returned: ${shown.length}（已截断，最多 ${MAX_RESULTS} 条）`
      : `returned: ${shown.length}`,
    '---',
  ];

  if (absPaths.length === 0) {
    lines.push('(无匹配文件)');
  } else {
    lines.push(...absPaths);
  }

  return lines.join('\n');
}

export const toolList = [
  {
    type: 'function',
    function: {
      name: 'glob',
      description:
        "根据 glob 模式查找项目内文件，例如 '*.js' 或 'src/**/*.ts'，返回匹配文件的绝对路径列表。查看项目结构、寻找相关文件时必须使用本工具，不要用 bash 的 ls/dir/find。自动跳过 node_modules、.git 等目录。",
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: "glob 模式，如 '*.js'、'**/*.ts'、'src/**/*.vue'",
          },
        },
        required: ['pattern'],
      },
    },
  },
];

export const toolMap = {
  glob: runGlob,
};
