import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 将内容写入本地文件：已存在则覆盖，不存在则创建（含父目录）
 * @param {{ path?: string, content?: string }} args
 * @returns {Promise<string>}
 */
async function runWriteFile({ path: filePath, content } = {}) {
  const target = String(filePath ?? '').trim();
  if (!target) {
    return 'write_file 失败：path 不能为空';
  }
  if (!isAbsolute(target)) {
    return `write_file 失败：path 必须是绝对路径，收到：${target}`;
  }
  if (content == null) {
    return 'write_file 失败：content 不能为空（可为空字符串，但参数必须提供）';
  }

  const text = String(content);
  const existed = await fileExists(target);

  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
  } catch (err) {
    return `write_file 失败：写入出错（${err?.message || String(err)}）`;
  }

  const bytes = Buffer.byteLength(text, 'utf8');
  if (existed) {
    return [
      `status: overwritten`,
      `path: ${target}`,
      `bytes: ${bytes}`,
      '说明：文件原先已存在，内容已被覆盖写入。',
    ].join('\n');
  }

  return [
    `status: created`,
    `path: ${target}`,
    `bytes: ${bytes}`,
    '说明：文件原先不存在，已创建并写入。',
  ].join('\n');
}

export const toolList = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        '将内容写入本地文件系统。已存在的文件将被覆盖；不存在的文件会创建并写入（自动创建缺失的父目录）。规范：1）若目标文件已存在，必须先用 read_file 读取再写入，除非用户明确要求新建；2）写入前必须先调用 confirm 获得用户确认，除非用户明确说明不用确认/不用提醒。path 必须是绝对路径。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要写入的文件绝对路径',
          },
          content: {
            type: 'string',
            description: '要写入的完整文件内容',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
];

export const toolMap = {
  write_file: runWriteFile,
};
