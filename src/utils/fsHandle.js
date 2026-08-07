import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { getCwd, getUserHomeDir } from './pathUtils.js';

/**
 * 根据路径得到可用于文件夹名的项目名（取路径最后一级）
 * @param {string} projectPath
 * @returns {string}
 */
function getProjectFolderName(projectPath) {
  const name = basename(projectPath);
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'unknown-project';
}

/**
 * 从当前目录向上查找含 package.json 的项目根目录，避免 cwd 落在 src 等子目录时名字不对
 * @param {string} startDir
 * @returns {Promise<string>}
 */
export async function findProjectRoot(startDir) {
  let dir = startDir;
  while (true) {
    try {
      await access(join(dir, 'package.json'));
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) {
        return startDir;
      }
      dir = parent;
    }
  }
}

/**
 * 将数据以 JSON 写入用户目录下的 .front/<项目名>/history.json
 * 目录不存在时会自动创建。项目名取自项目根目录名（含 package.json 的目录）。
 *
 * 目标路径示例：
 *   C:\Users\<user>\.front\frontCode\history.json
 *
 * @param {unknown} data 任意可 JSON 序列化的数据
 * @returns {Promise<string>} 写入后的文件绝对路径
 */
export async function saveHistoryJson(data) {
  const projectRoot = await findProjectRoot(getCwd());
  const projectName = getProjectFolderName(projectRoot);
  const projectDir = join(getUserHomeDir(), '.front', projectName);

  await mkdir(projectDir, { recursive: true });

  const filePath = join(projectDir, 'history.json');
  const json = JSON.stringify(data, null, 2);
  await writeFile(filePath, json, 'utf8');

  return filePath;
}
