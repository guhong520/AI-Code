import readline from 'node:readline';
import chalk from 'chalk';

/**
 * 向终端询问一行确认输入
 * @param {string} prompt
 * @returns {Promise<string>}
 */
function askLine(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

/**
 * @param {string} answer
 * @returns {boolean}
 */
function isApproved(answer) {
  const a = String(answer || '')
    .trim()
    .toLowerCase();
  return (
    a === 'y' ||
    a === 'yes' ||
    a === '是' ||
    a === '确认' ||
    a === '同意' ||
    a === 'ok'
  );
}

/**
 * 请求用户确认危险操作
 * @param {{ message?: string, action?: string }} args
 * @returns {Promise<string>}
 */
async function runConfirm({ message, action } = {}) {
  const msg = String(message ?? '').trim() || '即将执行可能有风险的操作';
  const act = String(action ?? '').trim();

  if (!process.stdin.isTTY) {
    return [
      'confirmed: false',
      'reason: non_interactive',
      '说明：当前环境无法交互确认，已拒绝该操作。请勿继续执行。',
    ].join('\n');
  }

  console.log();
  console.log(chalk.yellow.bold('⚠ 需要你的确认'));
  if (act) {
    console.log(chalk.gray('操作类型：') + chalk.white(act));
  }
  console.log(chalk.white(msg));
  console.log(chalk.gray('输入 y/yes/是 确认，其它输入或回车视为取消'));

  let answer;
  try {
    answer = await askLine(chalk.yellow('是否继续？[y/N] '));
  } catch (err) {
    return [
      'confirmed: false',
      'reason: ask_failed',
      `说明：确认输入失败（${err?.message || String(err)}），请勿继续执行。`,
    ].join('\n');
  }

  if (isApproved(answer)) {
    return [
      'confirmed: true',
      act ? `action: ${act}` : null,
      '说明：用户已确认，可以继续执行该操作。',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    'confirmed: false',
    act ? `action: ${act}` : null,
    `user_input: ${answer || '(空)'}`,
    '说明：用户拒绝或未确认，请停止该操作，不要继续执行；可询问用户如何调整。',
  ]
    .filter(Boolean)
    .join('\n');
}

export const toolList = [
  {
    type: 'function',
    function: {
      name: 'confirm',
      description:
        '在执行危险或不可逆操作前，必须先调用本工具向用户确认。典型场景：写入/新建/覆盖文件（write_file）、删除或批量改动、执行有副作用的 bash 命令、可能造成数据泄露或不可逆后果的操作。除非用户在本轮对话中明确说明「不用确认 / 不用提醒 / 直接执行」，否则不得跳过。根据返回的 confirmed=true/false 决定是否继续；为 false 时必须停止该操作。',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description:
              '向用户展示的确认说明，需清楚写明将做什么、影响哪些路径/范围、有何风险',
          },
          action: {
            type: 'string',
            description:
              '可选。操作类型简短标签，例如 write_file、bash、delete、overwrite 等',
          },
        },
        required: ['message'],
      },
    },
  },
];

export const toolMap = {
  confirm: runConfirm,
};
