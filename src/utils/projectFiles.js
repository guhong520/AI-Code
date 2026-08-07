import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { findProjectRoot } from './fsHandle.js';
import { getCwd } from './pathUtils.js';

/** 忽略的目录名 */
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.front',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  'out',
]);

/** 忽略的文件名 */
const IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db']);

/** @type {{ root: string, files: string[] } | null} */
let cache = null;

/**
 * 递归收集项目内相对路径文件列表
 * @param {string} dir
 * @param {string} root
 * @param {string[]} out
 */
async function walk(dir, root, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith('.') && name !== '.env.example') {
      // 跳过隐藏目录/文件，但保留常见示例；.git 等已在 IGNORE_DIRS
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(name)) continue;
        // 其他以 . 开头的目录也跳过
        continue;
      }
      if (IGNORE_FILES.has(name)) continue;
      // 隐藏文件默认跳过（避免把密钥等塞进列表）
      if (name.startsWith('.')) continue;
    }

    const full = join(dir, name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(name)) continue;
      await walk(full, root, out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (IGNORE_FILES.has(name)) continue;

    const rel = relative(root, full).split(sep).join('/');
    out.push(rel);
  }
}

/**
 * 获取项目文件相对路径列表（带缓存）
 * @param {{ refresh?: boolean }} [options]
 * @returns {Promise<string[]>}
 */
export async function listProjectFiles(options = {}) {
  const root = await findProjectRoot(getCwd());

  if (!options.refresh && cache && cache.root === root) {
    return cache.files;
  }

  const files = [];
  await walk(root, root, files);
  files.sort((a, b) => a.localeCompare(b));
  cache = { root, files };
  return files;
}

/**
 * 按前缀过滤文件路径（大小写不敏感）
 * @param {string} prefix 不含 @ 的路径前缀，如 "src/ap"
 * @param {string[]} [files]
 * @returns {Promise<string[]>}
 */
export async function filterProjectFiles(prefix, files) {
  const list = files || (await listProjectFiles());
  const p = String(prefix || '').toLowerCase().replace(/\\/g, '/');
  if (!p) {
    return list;
  }
  return list.filter((f) => {
    const lower = f.toLowerCase();
    if (lower.startsWith(p)) return true;
    return lower.split('/').some((seg) => seg.startsWith(p));
  });
}

/**
 * 当前缓存的项目根目录
 * @returns {Promise<string>}
 */
export async function getProjectRoot() {
  return findProjectRoot(getCwd());
}
