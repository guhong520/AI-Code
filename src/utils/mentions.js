import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getProjectRoot } from './projectFiles.js';

/** 单文件注入上下文的最大字节数 */
const MAX_FILE_BYTES = 100 * 1024;

/**
 * 从用户输入中提取所有 @路径 提及
 * @param {string} input
 * @returns {{ cleanText: string, files: string[] }}
 */
export function extractMentions(input) {
  const text = String(input || '');
  const files = [];
  const seen = new Set();

  // @path：路径可含字母数字、./_-\ 以及中文等非空白；到空白或行尾结束
  const re = /@([^\s@]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const rel = m[1].replace(/\\/g, '/');
    if (!seen.has(rel)) {
      seen.add(rel);
      files.push(rel);
    }
  }

  return { cleanText: text.trim(), files };
}

/**
 * 读取被 @ 的文件并拼成发给大模型的 user content
 * @param {string} input
 * @param {{ onWarn?: (msg: string) => void }} [options]
 * @returns {Promise<string>}
 */
export async function buildUserContent(input, options = {}) {
  const { cleanText, files } = extractMentions(input);
  if (files.length === 0) {
    return cleanText;
  }

  const root = await getProjectRoot();
  const parts = [cleanText];

  for (const rel of files) {
    const abs = join(root, rel);
    try {
      let content = await readFile(abs, 'utf8');
      // 简单跳过明显二进制（含大量 NUL）
      if (content.includes('\u0000')) {
        options.onWarn?.(`跳过二进制文件：${rel}`);
        continue;
      }
      if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
        const truncated = Buffer.from(content, 'utf8')
          .subarray(0, MAX_FILE_BYTES)
          .toString('utf8');
        content = `${truncated}\n\n…[已截断，原文件超过 ${MAX_FILE_BYTES} 字节]`;
      }
      parts.push(`\n--- file: ${rel} ---\n${content}`);
    } catch (err) {
      options.onWarn?.(`无法读取 @${rel}：${err.message}`);
    }
  }

  return parts.join('\n');
}
