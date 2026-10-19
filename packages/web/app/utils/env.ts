/** Where the API answers. The session cookie belongs to that origin. */
export const apiUrl = (import.meta.env.VITE_API as string | undefined)?.replace(/\/+$/, '') ?? '';
