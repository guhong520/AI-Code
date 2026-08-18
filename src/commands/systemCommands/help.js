import chalk from 'chalk';
import { printSystem } from '../../utils/terminal.js';

/** @type {import('./registry.js').CommandDef} */
export default {
  name: '/help',
  description: '显示帮助',
  blocking: true,
  async run({ commands }) {
    console.log();
    printSystem('可用命令：');
    for (const cmd of commands) {
      const kind = cmd.blocking
        ? chalk.gray('[阻断]')
        : chalk.gray('[非阻断]');
      const alias =
        cmd.aliases && cmd.aliases.length
          ? chalk.gray(`（${cmd.aliases.join(', ')}）`)
          : '';
      printSystem(`${cmd.name.padEnd(8)} ${kind} ${cmd.description}${alias}`);
    }
    console.log();
    printSystem('提示：行首输入 / 可上下选择指令，Tab 确认');
    printSystem('提示：输入 @ 可选择项目文件，内容会作为上下文发给模型');
    printSystem('提示：输入 # 可选择 .front/design 中的图片，文字为 text、图片为 image_url 发给模型');
    printSystem(
      '提示：阻断类指令只本地执行；非阻断类会把返回内容与用户文本一并发给模型',
    );
    printSystem(
      '提示：自定义指令放在 ~/.front/commands/<组>/<名>.md 或项目 .front/commands/，格式为 /组:名',
    );
    console.log();
    return { type: 'blocking' };
  },
};
