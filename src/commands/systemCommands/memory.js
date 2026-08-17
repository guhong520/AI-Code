import chalk from 'chalk';
import { buildMemoryPrompt } from '../../utils/memoryUtils.js';
import { printSystem } from '../../utils/terminal.js';

const DEFAULT_USER_TEXT =
  '请严格按模板要求提炼并更新用户级与项目级记忆，分别调用 memory_save（scope=user / scope=project）写入本地文件。完成后简要说明写入了哪些记忆路径。';

/** @type {import('../registry.js').CommandDef} */
export default {
  name: '/memory',
  description: '根据近 50 条对话更新用户/项目记忆（非阻断）',
  aliases: ['/mem'],
  blocking: false,
  async run({ args, history }) {
    printSystem(chalk.gray('正在汇总对话历史与现有记忆…'));
    const { prompt, paths, historyCount } = await buildMemoryPrompt(history);

    printSystem(chalk.gray(`已载入对话 ${historyCount} 条`));
    printSystem(chalk.gray(`用户记忆：${paths.userMemory}`));
    printSystem(chalk.gray(`项目记忆：${paths.projectMemory}`));
    printSystem(chalk.gray('已注入记忆模板，交给模型更新并落盘'));

    return {
      type: 'passthrough',
      context: prompt,
      userText: args || DEFAULT_USER_TEXT,
      skipRag: true,
    };
  },
};
