import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findProjectRoot } from '../utils/fsHandle.js';
import { getCwd, getUserHomeDir } from '../utils/pathUtils.js';

/** 文件夹 / 文件名（不含扩展名）允许的字符 */
const NAME_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * @param {string} text
 * @returns {string}
 */
function extractDescription(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const heading = t.match(/^#+\s+(.+)$/);
    if (heading) {
      return heading[1].trim().slice(0, 80);
    }
    return t.replace(/^[*_`]+|[*_`]+$/g, '').slice(0, 80);
  }
  return '自定义指令';
}

/**
 * 列出目录下的一级子目录；目录不存在时返回空数组
 * @param {string} dir
 * @returns {Promise<import('node:fs').Dirent[]>}
 */
async function listDirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory());
  } catch {
    return [];
  }
}

/**
 * 列出目录下的 .md 文件
 * @param {string} dir
 * @returns {Promise<import('node:fs').Dirent[]>}
 */
async function listMdFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(
      (e) => e.isFile() && e.name.toLowerCase().endsWith('.md'),
    );
  } catch {
    return [];
  }
}

/**
 * 从单个 commands 根目录扫描自定义指令
 * @param {string} commandsRoot
 * @param {'user' | 'project'} source
 * @returns {Promise<import('./registry.js').CommandDef[]>}
 */
async function scanCommandsRoot(commandsRoot, source) {
  /** @type {import('./registry.js').CommandDef[]} */
  const result = [];
  const folders = await listDirs(commandsRoot);

  for (const folder of folders) {
    if (!NAME_RE.test(folder.name)) {
      continue;
    }

    const folderPath = join(commandsRoot, folder.name);
    const mdFiles = await listMdFiles(folderPath);

    for (const file of mdFiles) {
      const stem = file.name.slice(0, -3); // 去掉 .md
      if (!NAME_RE.test(stem)) {
        continue;
      }

      const mdPath = join(folderPath, file.name);
      let description = '自定义指令';
      try {
        const raw = await readFile(mdPath, 'utf8');
        description = extractDescription(raw);
      } catch {
        // 读失败时仍注册，执行时再报错
      }

      const name = `/${folder.name}:${stem}`;
      const sourceLabel = source === 'user' ? '用户' : '项目';

      result.push({
        name,
        description: `${description}（${sourceLabel}）`,
        blocking: false,
        async run({ args }) {
          let content;
          try {
            content = (await readFile(mdPath, 'utf8')).trim();
          } catch (err) {
            content = `（无法读取自定义指令文件：${err.message}）`;
          }

          return {
            type: 'passthrough',
            context: [
              `--- custom command ${name} ---`,
              content || '（文件为空）',
              `--- end custom command ---`,
            ].join('\n'),
            userText: String(args || '').trim(),
          };
        },
      });
    }
  }

  return result;
}

/**
 * 加载用户目录与当前项目下的自定义斜杠指令
 *
 * 路径：
 *   - ~/.front/commands/<folder>/<name>.md  → /folder:name
 *   - <project>/.front/commands/<folder>/<name>.md → /folder:name
 *
 * 冲突时：项目覆盖用户；内置命令由 registry 另行优先。
 *
 * @returns {Promise<import('./registry.js').CommandDef[]>}
 */
export async function loadCustomCommands() {
  const userRoot = join(getUserHomeDir(), '.front', 'commands');
  const projectRoot = await findProjectRoot(getCwd());
  const projectCommandsRoot = join(projectRoot, '.front', 'commands');

  const [userCmds, projectCmds] = await Promise.all([
    scanCommandsRoot(userRoot, 'user'),
    scanCommandsRoot(projectCommandsRoot, 'project'),
  ]);

  /** @type {Map<string, import('./registry.js').CommandDef>} */
  const byName = new Map();

  for (const cmd of userCmds) {
    byName.set(cmd.name.toLowerCase(), cmd);
  }
  // 项目级覆盖同名用户指令
  for (const cmd of projectCmds) {
    byName.set(cmd.name.toLowerCase(), cmd);
  }

  return [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}
