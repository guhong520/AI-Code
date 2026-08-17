import {
  getProjectMemoryPath,
  getUserMemoryPath,
  writeTextFile,
} from '../../utils/memoryUtils.js';

/**
 * 将新记忆写入本地文件（目录不存在则创建）
 * @param {{ scope?: string, content?: string }} [args]
 * @returns {Promise<string>}
 */
async function runMemorySave({ scope, content } = {}) {
  const kind = String(scope ?? '').trim().toLowerCase();
  if (kind !== 'user' && kind !== 'project') {
    return 'memory_save 失败：scope 必须是 user 或 project';
  }
  if (content == null) {
    return 'memory_save 失败：content 不能为空（可为空字符串，但参数必须提供）';
  }

  const target =
    kind === 'user' ? getUserMemoryPath() : await getProjectMemoryPath();

  try {
    const { path, created } = await writeTextFile(target, String(content));
    const bytes = Buffer.byteLength(String(content), 'utf8');
    return [
      `status: ${created ? 'created' : 'updated'}`,
      `scope: ${kind}`,
      `path: ${path}`,
      `bytes: ${bytes}`,
      created
        ? '说明：记忆文件原先不存在，已创建并写入。'
        : '说明：记忆文件已更新覆盖写入。',
    ].join('\n');
  } catch (err) {
    return `memory_save 失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

export const toolList = [
  {
    type: 'function',
    function: {
      name: 'memory_save',
      description:
        '将提炼后的记忆写入本地文件。scope=user 写入 ~/.front/memory/memory.md；scope=project 写入当前项目 .front/memory/memory.md。目录或文件不存在时自动创建。更新记忆时应对 user、project 分别调用一次本工具。',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['user', 'project'],
            description: '写入范围：user 或 project',
          },
          content: {
            type: 'string',
            description: '完整的记忆 Markdown 正文',
          },
        },
        required: ['scope', 'content'],
      },
    },
  },
];

export const toolMap = {
  memory_save: runMemorySave,
};
