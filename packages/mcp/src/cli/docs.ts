import type { ErrorCode } from './errors.ts';
import type { Rule } from './rules.ts';

/** The site of the documentation. Each rule and each error code has a page there (G8N-82). */
export const DOCS_URL = 'https://git8n.sakuga.dev/docs/';

export const ruleUrl = (rule: Rule): string => `${DOCS_URL}reference/rules/${rule}.html`;

export const errorUrl = (code: ErrorCode): string => `${DOCS_URL}reference/errors/${code.toLowerCase()}.html`;
