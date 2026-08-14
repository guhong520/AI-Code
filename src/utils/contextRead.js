import { readdir, readFile } from 'node:fs/promises';
import { arch, platform, release, type } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProjectRoot } from './projectFiles.js';
import { getUserHomeDir } from './pathUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 从头部文本中解析 name 字段；没有则返回空字符串
 * @param {string} header
 * @returns {string}
 */
function parseSkillName(header) {
  const match = String(header).match(/^name\s*:\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

/**
 * 从 SKILL.md 文本中提取 --- ... --- 头部内容（不含分隔符）
 * @param {string} content
 * @returns {string}
 */
function extractSkillHeader(content) {
  const match = String(content).match(/---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1].trim() : '';
}

/**
 * 将单个 skill 的名称、文件地址与头部拼成一段说明文本
 * @param {{ name: string, path: string, header: string }} skill
 * @returns {string}
 */
function formatSkillBlock(skill) {
  return [
    `Skill 名称：${skill.name}`,
    `该 Skill 的文件地址：${skill.path}`,
    skill.header,
  ].join('\n');
}

/**
 * 收集指定 skills 目录下各子文件夹中 SKILL.md 的头部与路径信息
 * @param {string} skillsDir
 * @returns {Promise<{ name: string, path: string, header: string }[]>}
 */
async function collectSkillHeadersFromDir(skillsDir) {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name, 'SKILL.md');
    try {
      const raw = await readFile(skillPath, 'utf8');
      const header = extractSkillHeader(raw);
      if (!header) continue;
      skills.push({
        name: parseSkillName(header) || entry.name,
        path: skillPath,
        header,
      });
    } catch {
      // SKILL.md 不存在则跳过
    }
  }
  return skills;
}

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

/**
 * 读取用户目录与项目目录下 .front/skills 各子目录 SKILL.md 的 YAML 头部，
 * 并为每个 skill 附上名称与文件地址，拼接后替换 docs/skillTemplate.md 中的 ${skillcontent}
 * - ~/.front/skills/<name>/SKILL.md
 * - <projectRoot>/.front/skills/<name>/SKILL.md
 * @returns {Promise<string>}
 */
export async function getSkillHeaders() {
  const templatePath = join(__dirname, '..', 'docs', 'skillTemplate.md');
  const template = await readFile(templatePath, 'utf8');

  const skillRoots = [
    join(getUserHomeDir(), '.front', 'skills'),
    join(await getProjectRoot(), '.front', 'skills'),
  ];

  const skills = [];
  for (const skillsDir of skillRoots) {
    skills.push(...(await collectSkillHeadersFromDir(skillsDir)));
  }

  const skillcontent = skills.map(formatSkillBlock).join('\n\n');
  return template.replaceAll('${skillcontent}', skillcontent).trim();
}
