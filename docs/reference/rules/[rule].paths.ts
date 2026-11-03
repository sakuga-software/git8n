import { ruleIds, rulePage, rulesIndex } from '../../.vitepress/reference.ts';

export default {
  paths: async () => [
    { params: { rule: 'index' }, content: rulesIndex() },
    ...(await Promise.all(ruleIds.map(async (rule) => ({ params: { rule }, content: await rulePage(rule) })))),
  ],
};
