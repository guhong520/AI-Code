import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { getDesignDir, getProjectRoot } from './projectFiles.js';

/** 单文件注入上下文的最大字节数 */
const MAX_FILE_BYTES = 100 * 1024;

/** 单张设计图最大字节数，避免 base64 撑爆请求 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** # 提及的图片扩展名 */
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp)$/i;

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * 判断 child 是否落在 parent 目录内（含自身）
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function isPathInside(parent, child) {
  const root = resolve(parent);
  const target = resolve(child);
  const r = process.platform === 'win32' ? root.toLowerCase() : root;
  const t = process.platform === 'win32' ? target.toLowerCase() : target;
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep);
}

/**
 * 从用户输入中提取所有 @路径 与 #设计图 提及
 * @param {string} input
 * @returns {{ cleanText: string, files: string[], images: string[] }}
 */
export function extractMentions(input) {
  const text = String(input || '');
  const files = [];
  const images = [];
  const seenFiles = new Set();
  const seenImages = new Set();

  // @path：路径可含字母数字、./_-\ 以及中文等非空白；到空白或行尾结束
  const atRe = /@([^\s@]+)/g;
  let m;
  while ((m = atRe.exec(text)) !== null) {
    const rel = m[1].replace(/\\/g, '/');
    if (!seenFiles.has(rel)) {
      seenFiles.add(rel);
      files.push(rel);
    }
  }

  // #image：仅匹配带图片扩展名的 token，避免把 #fff 等当成设计图
  const hashRe = /#([^\s#]+)/g;
  while ((m = hashRe.exec(text)) !== null) {
    const rel = m[1].replace(/\\/g, '/');
    if (!IMAGE_EXT_RE.test(rel)) continue;
    if (!seenImages.has(rel)) {
      seenImages.add(rel);
      images.push(rel);
    }
  }

  return { cleanText: text.trim(), files, images };
}

/**
 * 读取被 @ 的文件文本，拼到提问文字后面
 * @param {string} cleanText
 * @param {string[]} files
 * @param {{ onWarn?: (msg: string) => void }} [options]
 * @returns {Promise<string>}
 */
async function appendMentionedFiles(cleanText, files, options = {}) {
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

/**
 * 读取 # 提及的设计图，转为 data URL
 * @param {string[]} images
 * @param {{ onWarn?: (msg: string) => void }} [options]
 * @returns {Promise<{ type: 'image_url', image_url: { url: string } }[]>}
 */
async function loadDesignImageParts(images, options = {}) {
  if (images.length === 0) {
    return [];
  }

  const designDir = await getDesignDir();
  const parts = [];

  for (const rel of images) {
    const abs = resolve(designDir, rel);
    if (!isPathInside(designDir, abs)) {
      options.onWarn?.(`跳过非法设计图路径：${rel}`);
      continue;
    }

    const mime = MIME_BY_EXT[extname(abs).toLowerCase()];
    if (!mime) {
      options.onWarn?.(`不支持的设计图格式：${rel}`);
      continue;
    }

    try {
      const buf = await readFile(abs);
      if (buf.length > MAX_IMAGE_BYTES) {
        options.onWarn?.(
          `跳过过大的设计图：${rel}（超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB）`,
        );
        continue;
      }
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${mime};base64,${buf.toString('base64')}`,
        },
      });
    } catch (err) {
      options.onWarn?.(`无法读取设计图 #${rel}：${err.message}`);
    }
  }

  return parts;
}

/**
 * 读取被 @ 的文件、# 的设计图，拼成发给大模型的 user content
 * 无设计图时返回字符串；有设计图时返回 OpenAI 多模态数组
 * @param {string} input
 * @param {{ onWarn?: (msg: string) => void }} [options]
 * @returns {Promise<string | { type: string, text?: string, image_url?: { url: string } }[]>}
 */
export async function buildUserContent(input, options = {}) {
  const { cleanText, files, images } = extractMentions(input);
  const text = await appendMentionedFiles(cleanText, files, options);
  const imageParts = await loadDesignImageParts(images, options);

  if (imageParts.length === 0) {
    return text;
  }

  /** @type {{ type: string, text?: string, image_url?: { url: string } }[]} */
  const parts = [];
  const trimmed = String(text || '').trim();
  parts.push({
    type: 'text',
    text: trimmed || `请查看设计图：${images.join(', ')}`,
  });
  parts.push(...imageParts);
  return parts;
}

/**
 * 从 user content（字符串或多模态数组）中取出纯文本，供 RAG / 判空使用
 * @param {unknown} content
 * @returns {string}
 */
export function extractTextFromContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text' && p.text)
      .map((p) => String(p.text))
      .join('\n');
  }
  return '';
}

/**
 * 用 RAG 文本替换 content 中的文字部分，保留图片
 * @param {unknown} content
 * @param {string} ragPrompt
 * @returns {unknown}
 */
export function applyRagToContent(content, ragPrompt) {
  const rag = String(ragPrompt || '');
  if (!rag) return content;
  if (Array.isArray(content)) {
    const images = content.filter((p) => p && p.type === 'image_url');
    return [{ type: 'text', text: rag }, ...images];
  }
  return rag;
}

/**
 * 用户 content 是否为空（无文字且无图片）
 * @param {unknown} content
 * @returns {boolean}
 */
export function isEmptyUserContent(content) {
  if (Array.isArray(content)) {
    return content.length === 0;
  }
  return !String(content || '').trim();
}
