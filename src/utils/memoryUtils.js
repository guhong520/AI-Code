import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findProjectRoot } from './fsHandle.js';
import { getCwd, getUserHomeDir } from './pathUtils.js';
import { getProjectRoot } from './projectFiles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_LIMIT = 50;

/**
 * @param {string} projectPath
 * @returns {string}
 */
function getProjectFolderName(projectPath) {
  const name = basename(projectPath);
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'unknown-project';
}

/**
 * 用户级记忆：~/.front/memory/memory.md
 * @returns {string}
 */
export function getUserMemoryPath() {
  return join(getUserHomeDir(), '.front', 'memory', 'memory.md');
}

/**
 * 项目级记忆：<project>/.front/memory/memory.md
 * @param {string} [projectRoot]
 * @returns {Promise<string>}
 */
export async function getProjectMemoryPath(projectRoot) {
  const root = projectRoot || (await getProjectRoot());
  return join(root, '.front', 'memory', 'memory.md');
}

/**
 * 用户级 front.md
 * @returns {string}
 */
export function getUserFrontMdPath() {
  return join(getUserHomeDir(), '.front', 'front.md');
}

/**
 * 项目级 front.md（项目根目录）
 * @param {string} [projectRoot]
 * @returns {Promise<string>}
 */
export async function getProjectFrontMdPath(projectRoot) {
  const root = projectRoot || (await getProjectRoot());
  return join(root, 'front.md');
}

/**
 * 当前项目对话历史落盘路径：~/.front/<项目名>/history.json
 * @returns {Promise<string>}
 */
export async function getProjectHistoryPath() {
  const projectRoot = await findProjectRoot(getCwd());
  const projectName = getProjectFolderName(projectRoot);
  return join(getUserHomeDir(), '.front', projectName, 'history.json');
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function readTextOrEmpty(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * @param {string} filePath
 * @param {string} content
 * @returns {Promise<{ path: string, created: boolean }>}
 */
export async function writeTextFile(filePath, content) {
  let created = false;
  try {
    await access(filePath);
  } catch {
    created = true;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, String(content ?? ''), 'utf8');
  return { path: filePath, created };
}

/**
 * 从磁盘读取项目历史
 * @returns {Promise<Array<{ role: string, content?: string | null, tool_calls?: unknown[] }>>}
 */
export async function loadSavedHistory() {
  const path = await getProjectHistoryPath();
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * 取最近 N 条对话：优先当前会话，不足时用磁盘历史补齐
 * @param {Array<{ role: string, content?: string | null }> } [sessionHistory]
 * @param {number} [limit]
 * @returns {Promise<Array<{ role: string, content?: string | null }>>}
 */
export async function getRecentHistory(sessionHistory = [], limit = HISTORY_LIMIT) {
  const live = Array.isArray(sessionHistory) ? sessionHistory : [];
  if (live.length >= limit) {
    return live.slice(-limit);
  }
  const saved = await loadSavedHistory();
  if (live.length === 0) {
    return saved.slice(-limit);
  }
  return [...saved, ...live].slice(-limit);
}

/**
 * 将对话记录格式化为模板中的 ${record}
 * @param {Array<{ role: string, content?: string | null, tool_calls?: unknown[] }>} messages
 * @returns {string}
 */
export function formatHistoryRecord(messages) {
  if (!messages?.length) {
    return '（暂无对话记录）';
  }
  return messages
    .map((msg, i) => {
      const role = String(msg.role || 'unknown');
      let body = '';
      if (typeof msg.content === 'string' && msg.content.trim()) {
        body = msg.content.trim();
      } else if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        body = `[tool_calls] ${JSON.stringify(msg.tool_calls)}`;
      } else {
        body = '（空内容）';
      }
      return `### [${i + 1}] ${role}\n${body}`;
    })
    .join('\n\n');
}

/**
 * 读取记忆与 front.md，结合最近对话填入 memoryTemplate.md
 * @param {Array<{ role: string, content?: string | null }> } [sessionHistory]
 * @returns {Promise<{
 *   prompt: string,
 *   paths: { userMemory: string, projectMemory: string, userMd: string, projectMd: string },
 *   historyCount: number,
 * }>}
 */
export async function buildMemoryPrompt(sessionHistory = []) {
  const templatePath = join(__dirname, '..', 'docs', 'memoryTemplate.md');
  const template = await readFile(templatePath, 'utf8');

  const userMemoryPath = getUserMemoryPath();
  const projectMemoryPath = await getProjectMemoryPath();
  const userMdPath = getUserFrontMdPath();
  const projectMdPath = await getProjectFrontMdPath();

  const [userMemory, projectMemory, userMd, projectMd, recent] =
    await Promise.all([
      readTextOrEmpty(userMemoryPath),
      readTextOrEmpty(projectMemoryPath),
      readTextOrEmpty(userMdPath),
      readTextOrEmpty(projectMdPath),
      getRecentHistory(sessionHistory, HISTORY_LIMIT),
    ]);

  const record = formatHistoryRecord(recent);
  const prompt = template
    .replaceAll('${projectMemory}', projectMemory || '（暂无项目记忆）')
    .replaceAll('${userMemory}', userMemory || '（暂无用户记忆）')
    .replaceAll('${projectMd}', projectMd || '（暂无项目 front.md）')
    .replaceAll('${userMd}', userMd || '（暂无用户 front.md）')
    .replaceAll('${record}', record)
    .trim();

  return {
    prompt,
    paths: {
      userMemory: userMemoryPath,
      projectMemory: projectMemoryPath,
      userMd: userMdPath,
      projectMd: projectMdPath,
    },
    historyCount: recent.length,
  };
}
