import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

/** 单次最多返回的行数 */
const MAX_LINES = 2000;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function toInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/**
 * 从本地文件系统读取文件（按行，支持 offset/limit）
 * @param {{ path?: string, offset?: number, limit?: number }} args
 * @returns {Promise<string>}
 */
async function runReadFile({ path: filePath, offset, limit } = {}) {
  const target = String(filePath ?? '').trim();
  if (!target) {
    return 'read_file 失败：path 不能为空';
  }
  if (!isAbsolute(target)) {
    return `read_file 失败：path 必须是绝对路径，收到：${target}`;
  }

  let info;
  try {
    info = await stat(target);
  } catch (err) {
    return `read_file 失败：无法访问文件 ${target}（${err?.message || String(err)}）`;
  }

  if (info.isDirectory()) {
    return `read_file 失败：${target} 是文件夹。要列出目录内容，请使用 bash 工具执行 ls（Windows 可用 dir）。`;
  }
  if (!info.isFile()) {
    return `read_file 失败：${target} 不是普通文件`;
  }

  let raw;
  try {
    raw = await readFile(target, 'utf8');
  } catch (err) {
    return `read_file 失败：读取出错（${err?.message || String(err)}）`;
  }

  const lines = raw.split(/\r?\n/);
  const totalLines = lines.length;

  // offset 从 1 起算；未传或非法时从第 1 行开始
  let start = toInt(offset, 1);
  if (start < 1) start = 1;
  if (start > totalLines) {
    return [
      `path: ${target}`,
      `total_lines: ${totalLines}`,
      `offset: ${start}`,
      `limit: 0`,
      '内容为空：offset 超出文件行数',
    ].join('\n');
  }

  let take = toInt(limit, MAX_LINES);
  if (take < 1) take = MAX_LINES;
  if (take > MAX_LINES) take = MAX_LINES;

  const slice = lines.slice(start - 1, start - 1 + take);
  const endLine = start + slice.length - 1;
  const truncated = start - 1 + take < totalLines || take >= MAX_LINES && endLine < totalLines;

  const header = [
    `path: ${target}`,
    `total_lines: ${totalLines}`,
    `offset: ${start}`,
    `limit: ${take}`,
    `returned_lines: ${slice.length}（第 ${start}-${endLine} 行）`,
    truncated && endLine < totalLines
      ? `note: 未读完，可增大 offset 继续读取（单次最多 ${MAX_LINES} 行）`
      : null,
  ].filter(Boolean);

  // 带行号，便于模型定位修改
  const body = slice
    .map((line, i) => `${String(start + i).padStart(6, ' ')}|${line}`)
    .join('\n');

  return `${header.join('\n')}\n---\n${body}`;
}

export const toolList = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        '从本地文件系统读取文件。可直接访问任意文件。参数 path 必须是绝对路径；默认从文件开头读取，单次最多 2000 行；可通过 offset（起始行，从 1 起算）与 limit（行数，最大 2000）控制读取范围。若要查看文件夹内容，请改用 bash 工具执行 ls（Windows 可用 dir），不要对本工具传入目录路径。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要读取的文件绝对路径',
          },
          offset: {
            type: 'integer',
            description: '起始行号，从 1 开始；默认 1（文件开头）',
          },
          limit: {
            type: 'integer',
            description: `读取行数，默认 ${MAX_LINES}，最大 ${MAX_LINES}`,
          },
        },
        required: ['path'],
      },
    },
  },
];

export const toolMap = {
  read_file: runReadFile,
};
