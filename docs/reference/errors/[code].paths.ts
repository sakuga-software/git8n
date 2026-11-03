import { errorCodes, errorPage, errorsIndex } from '../../.vitepress/reference.ts';

export default {
  paths: () => [
    { params: { code: 'index' }, content: errorsIndex() },
    ...errorCodes.map((code) => ({ params: { code: code.toLowerCase() }, content: errorPage(code) })),
  ],
};
