import readline from 'node:readline';
import chalk from 'chalk';

/** 最多展示的选项数 */
const MAX_OPTIONS = 12;

/**
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
 * 把模型传入的 options 规范成字符串数组
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeOptions(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (item == null) return '';
        if (typeof item === 'string') return item.trim();
        if (typeof item === 'object') {
          const label = item.label ?? item.text ?? item.name ?? item.value;
          return label == null ? '' : String(label).trim();
        }
        return String(item).trim();
      })
      .filter(Boolean);
  }

  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return normalizeOptions(parsed);
      }
    } catch {
      // 按换行或 | 分隔
    }
    return text
      .split(/\r?\n|\|/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return [];
}

/**
 * 解析用户输入的序号（支持单选；多选时用逗号/空格分隔）
 * @param {string} answer
 * @param {number} count
 * @param {boolean} allowMultiple
 * @returns {{ ok: true, indexes: number[] } | { ok: false, error: string }}
 */
function parseSelection(answer, count, allowMultiple) {
  const raw = String(answer || '').trim();
  if (!raw) {
    return { ok: false, error: '未输入选项' };
  }

  if (/^(q|quit|cancel|取消|退出)$/i.test(raw)) {
    return { ok: false, error: 'cancelled' };
  }

  const parts = allowMultiple
    ? raw.split(/[,，\s]+/).filter(Boolean)
    : [raw];

  /** @type {number[]} */
  const indexes = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 1 || n > count) {
      return {
        ok: false,
        error: `无效序号「${part}」，请输入 1-${count}`,
      };
    }
    if (!indexes.includes(n - 1)) {
      indexes.push(n - 1);
    }
  }

  if (!allowMultiple && indexes.length !== 1) {
    return { ok: false, error: '本次为单选，请只输入一个序号' };
  }

  return { ok: true, indexes };
}

/**
 * 向用户展示选项并收集选择
 * @param {{
 *   message?: string,
 *   question?: string,
 *   options?: unknown,
 *   allow_multiple?: boolean | string,
 * }} args
 * @returns {Promise<string>}
 */
async function runSelect(args = {}) {
  const message = String(args.message ?? args.question ?? '').trim();
  const options = normalizeOptions(args.options).slice(0, MAX_OPTIONS);
  const allowMultiple =
    args.allow_multiple === true || args.allow_multiple === 'true';

  if (!message) {
    return 'select 失败：message 不能为空';
  }
  if (options.length < 2) {
    return 'select 失败：options 至少需要 2 个有效选项';
  }

  if (!process.stdin.isTTY) {
    return [
      'selected: false',
      'reason: non_interactive',
      '说明：当前环境无法交互选择，请改用文字询问用户，或待用户明确后再继续。',
    ].join('\n');
  }

  console.log();
  console.log(chalk.cyan.bold('请选择'));
  console.log(chalk.white(message));
  console.log();
  options.forEach((opt, i) => {
    console.log(`  ${chalk.yellow(String(i + 1).padStart(2, ' '))}. ${opt}`);
  });
  console.log();
  console.log(
    chalk.gray(
      allowMultiple
        ? `输入序号（可多选，用逗号分隔），或输入 q 取消`
        : `输入序号 1-${options.length}，或输入 q 取消`,
    ),
  );

  const prompt = allowMultiple
    ? chalk.cyan('你的选择（可多选）› ')
    : chalk.cyan('你的选择 › ');

  /** 最多重试 3 次无效输入 */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let answer;
    try {
      answer = await askLine(prompt);
    } catch (err) {
      return [
        'selected: false',
        'reason: ask_failed',
        `说明：读取选择失败（${err?.message || String(err)}）`,
      ].join('\n');
    }

    const parsed = parseSelection(answer, options.length, allowMultiple);
    if (!parsed.ok) {
      if (parsed.error === 'cancelled') {
        return [
          'selected: false',
          'reason: cancelled',
          '说明：用户取消了选择。请停止当前不确定的操作，或换一种方式询问。',
        ].join('\n');
      }
      console.log(chalk.red(`  ${parsed.error}，请重试`));
      continue;
    }

    const selected = parsed.indexes.map((i) => options[i]);
    const lines = [
      'selected: true',
      `mode: ${allowMultiple ? 'multiple' : 'single'}`,
      `indexes: ${parsed.indexes.map((i) => i + 1).join(',')}`,
      `count: ${selected.length}`,
      'choices:',
      ...selected.map((s, i) => `  - [${parsed.indexes[i] + 1}] ${s}`),
      '说明：请严格按用户选中的选项继续推进需求，不要擅自换成未选项。',
    ];
    return lines.join('\n');
  }

  return [
    'selected: false',
    'reason: invalid_input',
    '说明：多次输入无效，未能完成选择。请用文字向用户确认后再继续。',
  ].join('\n');
}

export const toolList = [
  {
    type: 'function',
    function: {
      name: 'select',
      description:
        '当用户需求说不清楚、实现存在多种合理方案、或有重要细节尚未确定时，使用本工具向用户展示若干选项并等待选择。根据返回的 selected/choices 继续后续步骤；若 selected=false，不要擅自替用户做决定。不要用纯文字列表代替本工具（除非环境无法交互）。',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: '向用户说明需要选择的原因与问题（一句话问清楚）',
          },
          options: {
            type: 'array',
            description: '可供选择的选项列表，至少 2 项，建议 2-6 项，表述要具体可执行',
            items: {
              type: 'string',
            },
            minItems: 2,
          },
          allow_multiple: {
            type: 'boolean',
            description: '是否允许多选，默认 false（单选）',
          },
        },
        required: ['message', 'options'],
      },
    },
  },
];

export const toolMap = {
  select: runSelect,
};
