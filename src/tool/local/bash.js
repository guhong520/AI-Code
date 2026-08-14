import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import { getProjectRoot } from '../../utils/projectFiles.js';

const execAsync = promisify(exec);

/** 单次命令最长执行时间 */
const TIMEOUT_MS = 60_000;

/** stdout/stderr 合计最大字节（超限会被 Node 截断报错，这里再做文本截断） */
const MAX_BUFFER = 2 * 1024 * 1024;

/** 返回给模型的文本上限，避免撑爆上下文 */
const MAX_OUTPUT_CHARS = 40_000;

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max = MAX_OUTPUT_CHARS) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…(输出过长，已截断，共 ${s.length} 字符)`;
}

/**
 * 执行一条 shell 命令并格式化结果
 * @param {{ command?: string, cwd?: string }} args
 * @returns {Promise<string>}
 */
async function runBash({ command, cwd } = {}) {
  const cmd = String(command ?? '').trim();
  if (!cmd) {
    return 'bash 执行失败：command 不能为空';
  }

  const workDir = String(cwd || '').trim() || (await getProjectRoot());
  const os = platform();

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: workDir,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      // 使用系统默认 shell：Windows → cmd.exe，macOS/Linux → /bin/sh
      shell: true,
      encoding: 'utf8',
    });

    const out = truncate(stdout);
    const err = truncate(stderr);
    const parts = [
      `exit_code: 0`,
      `os: ${os}`,
      `cwd: ${workDir}`,
      `command: ${cmd}`,
    ];
    if (out) parts.push(`stdout:\n${out}`);
    if (err) parts.push(`stderr:\n${err}`);
    if (!out && !err) parts.push('(无输出)');
    return parts.join('\n');
  } catch (err) {
    const exitCode = typeof err?.code === 'number' ? err.code : 1;
    const out = truncate(err?.stdout);
    const errText = truncate(err?.stderr || err?.message || String(err));
    return [
      `exit_code: ${exitCode}`,
      `os: ${os}`,
      `cwd: ${workDir}`,
      `command: ${cmd}`,
      out ? `stdout:\n${out}` : '',
      errText ? `stderr:\n${errText}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

export const toolList = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description:
        '当需要做一些不能通过其他工具完成的事情时，可借助本工具执行 shell 命令，并把结果返回供后续分析。具体要执行的指令必须区分用户操作系统：Windows 使用 cmd/PowerShell 语法，macOS/Linux 使用 bash/sh 语法；不要在 Windows 上直接发 Linux 专用命令（反之亦然）。禁止用本工具搜索代码或罗列项目文件：内容搜索用 grep，按模式找文件用 glob。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description:
              '要执行的 shell 命令。请根据用户当前操作系统编写合适语法。',
          },
          cwd: {
            type: 'string',
            description: '可选。命令工作目录，默认为当前项目根目录。',
          },
        },
        required: ['command'],
      },
    },
  },
];

export const toolMap = {
  bash: runBash,
};
