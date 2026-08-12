/** @type {import('../registry.js').CommandDef} */
export default {
  name: '/exit',
  description: '退出程序',
  aliases: ['/quit'],
  blocking: true,
  async run({ rl, exitApp }) {
    await exitApp(rl);
    return { type: 'blocking' };
  },
};
