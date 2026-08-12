import chalk from 'chalk';
import { printSystem } from '../../utils/terminal.js';
import { buildProjectContext } from '../../utils/projectContext.js';

const DEFAULT_USER_TEXT =
  '请基于注入的项目信息，简要概述当前项目，并确认你已了解项目规范。';

/** @type {import('./registry.js').CommandDef} */
export default {
  name: '/project',
  description: '读取配置并注入项目信息（非阻断）',
  aliases: ['/proj'],
  blocking: false,
  async run({ args }) {
    printSystem(chalk.gray('正在读取项目配置与信息…'));
    const context = await buildProjectContext();
    printSystem(chalk.gray('已注入项目信息'));
    return {
      type: 'passthrough',
      context,
      userText: args || DEFAULT_USER_TEXT,
    };
  },
};
