import type { ApiConfig } from '@i18n-editor/mcp/api';
import { apiUrl } from './env';

/** No token: the browser sends the session cookie of the API. */
export const api: ApiConfig = { url: apiUrl };
