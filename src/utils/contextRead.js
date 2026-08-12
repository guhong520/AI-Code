import { readFile } from 'node:fs/promises';
import { arch, platform, release, type } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProjectRoot } from './projectFiles.js';
import { getUserHomeDir } from './pathUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 读取 docs/FrontSystem.md，替换操作系统与项目根目录占位符后返回
 * @returns {Promise<string>}
 */
export async function readSystem() {
  const path = join(__dirname, '..', 'docs', 'FrontSystem.md');
  const raw = await readFile(path, 'utf8');
  const systemInfo = `${type()} ${release()} (${platform()} ${arch()})`;
  const workPath = await getProjectRoot();

  return raw
    .replaceAll('${systemInfo}', systemInfo)
    .replaceAll('${workPath}', workPath)
    .trim();
}

/**
 * 读取 docs/userContext.md，注入用户级 front.md 与项目根目录 front.md
 * - ~/.front/front.md → ${userPath} / ${userContent}
 * - <projectRoot>/front.md → ${projectPath} / ${projectContent}
 * 文件不存在时对应占位符填空字符串
 * @returns {Promise<string>}
 */
export async function getUserContext() {
  const templatePath = join(__dirname, '..', 'docs', 'userContext.md');
  const template = await readFile(templatePath, 'utf8');

  const userPath = join(getUserHomeDir(), '.front', 'front.md');
  let userPathOut = '';
  let userContent = '';
  try {
    userContent = await readFile(userPath, 'utf8');
    userPathOut = userPath;
  } catch {
    // 文件不存在则保持空字符串
  }

  const projectPath = join(await getProjectRoot(), 'front.md');
  let projectPathOut = '';
  let projectContent = '';
  try {
    projectContent = await readFile(projectPath, 'utf8');
    projectPathOut = projectPath;
  } catch {
    // 文件不存在则保持空字符串
  }

  return template
    .replaceAll('${userPath}', userPathOut)
    .replaceAll('${userContent}', userContent)
    .replaceAll('${projectPath}', projectPathOut)
    .replaceAll('${projectContent}', projectContent)
    .trim();
}
