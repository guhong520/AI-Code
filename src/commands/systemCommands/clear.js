import { clearScreen, printBanner, printSystem } from '../../utils/terminal.js';

/** @type {import('../registry.js').CommandDef} */
export default {
  name: '/clear',
  description: '清空对话记录',
  blocking: true,
  async run({ history }) {
    history.length = 0;
    clearScreen();
    printBanner();
    printSystem('对话记录已清空');
    return { type: 'blocking' };
  },
};
