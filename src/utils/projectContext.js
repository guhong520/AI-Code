import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { findProjectRoot } from './fsHandle.js';
import { getCwd } from './pathUtils.js';
import { listProjectFiles } from './projectFiles.js';

/** 单段注入内容的最大字符数 */
const MAX_SECTION_CHARS = 12_000;

/** 文件树摘要最多列出的路径数 */
const MAX_TREE_FILES = 80;

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max = MAX_SECTION_CHARS) {
  const s = String(text || '');
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}\n\n…[已截断]`;
}

/**
 * 读取文本文件；不存在或失败时返回 null
 * @param {string} absPath
 * @returns {Promise<string | null>}
 */
async function readTextIfExists(absPath) {
  try {
    return await readFile(absPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 从 package.json 提取适合注入的摘要（不含私密信息）
 * @param {string} raw
 * @returns {string}
 */
function summarizePackageJson(raw) {
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return truncate(raw);
  }

  const pick = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: pkg.type,
    main: pkg.main,
    scripts: pkg.scripts,
    dependencies: pkg.dependencies
      ? Object.keys(pkg.dependencies)
      : undefined,
    devDependencies: pkg.devDependencies
      ? Object.keys(pkg.devDependencies)
      : undefined,
    engines: pkg.engines,
  };

  // 去掉 undefined 字段，保持紧凑
  for (const key of Object.keys(pick)) {
    if (pick[key] === undefined) {
      delete pick[key];
    }
  }

  return JSON.stringify(pick, null, 2);
}

/**
 * 列出项目根目录下一层条目（文件/目录名）
 * @param {string} root
 * @returns {Promise<string>}
 */
async function listTopLevel(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const lines = entries
      .filter((e) => !e.name.startsWith('.') || e.name === '.env.example')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    return lines.join('\n') || '(空)';
  } catch (err) {
    return `(无法读取：${err.message})`;
  }
}

/**
 * 收集并格式化为可注入大模型的项目信息字符串
 * @returns {Promise<string>}
 */
export async function buildProjectContext() {
  const cwd = getCwd();
  const root = await findProjectRoot(cwd);
  const parts = [
    '--- project info ---',
    `项目根目录：${root}`,
    `当前工作目录：${cwd}`,
    `项目文件夹名：${basename(root)}`,
  ];

  const pkgRaw = await readTextIfExists(join(root, 'package.json'));
  if (pkgRaw) {
    parts.push('', '## package.json（摘要）', summarizePackageJson(pkgRaw));
  } else {
    parts.push('', '## package.json', '（未找到）');
  }

  const agentMd = await readTextIfExists(join(root, 'agent.md'));
  if (agentMd) {
    parts.push('', '## agent.md（项目说明与规范）', truncate(agentMd.trim()));
  }

  const readme =
    (await readTextIfExists(join(root, 'README.md'))) ||
    (await readTextIfExists(join(root, 'readme.md')));
  if (readme) {
    parts.push('', '## README.md', truncate(readme.trim()));
  }

  parts.push('', '## 根目录结构', await listTopLevel(root));

  try {
    const files = await listProjectFiles();
    const shown = files.slice(0, MAX_TREE_FILES);
    const more =
      files.length > MAX_TREE_FILES
        ? `\n…另有 ${files.length - MAX_TREE_FILES} 个文件未列出`
        : '';
    parts.push(
      '',
      `## 项目文件列表（共 ${files.length} 个，最多展示 ${MAX_TREE_FILES} 个）`,
      shown.join('\n') + more,
    );
  } catch (err) {
    parts.push('', '## 项目文件列表', `（无法枚举：${err.message}）`);
  }

  parts.push('--- end project info ---');
  return parts.join('\n');
}
