import {
  getProjectMemoryPath,
  getUserMemoryPath,
  readTextOrEmpty,
} from '../../utils/memoryUtils.js';

/**
 * 读取用户级 / 项目级记忆文件
 * @param {{ scope?: string }} [args]
 * @returns {Promise<string>}
 */
async function runMemoryGet({ scope } = {}) {
  const raw = String(scope ?? 'all').trim().toLowerCase();
  const wantUser = raw === 'all' || raw === 'user';
  const wantProject = raw === 'all' || raw === 'project';

  if (!wantUser && !wantProject) {
    return 'memory_get 失败：scope 应为 user、project 或 all';
  }

  /** @type {string[]} */
  const parts = [];

  if (wantUser) {
    const path = getUserMemoryPath();
    const content = await readTextOrEmpty(path);
    parts.push(
      `## 用户级记忆\npath: ${path}\n\n${content || '（文件不存在或为空）'}`,
    );
  }

  if (wantProject) {
    const path = await getProjectMemoryPath();
    const content = await readTextOrEmpty(path);
    parts.push(
      `## 项目级记忆\npath: ${path}\n\n${content || '（文件不存在或为空）'}`,
    );
  }

  return parts.join('\n\n');
}

export const toolList = [
  {
    type: 'function',
    function: {
      name: 'memory_get',
      description:
        '读取本地记忆文件。scope=user 读用户级 ~/.front/memory/memory.md；scope=project 读当前项目 .front/memory/memory.md；scope=all（默认）两者都读。文件不存在时返回空说明。',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['user', 'project', 'all'],
            description: '读取范围：user / project / all',
          },
        },
        required: [],
      },
    },
  },
];

export const toolMap = {
  memory_get: runMemoryGet,
};
