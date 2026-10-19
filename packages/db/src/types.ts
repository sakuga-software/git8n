import type { i18nRepositories, i18nTranslators } from './schema';

export type I18nRepository = typeof i18nRepositories.$inferSelect;
export type NewI18nRepository = typeof i18nRepositories.$inferInsert;

export type I18nTranslator = typeof i18nTranslators.$inferSelect;
export type NewI18nTranslator = typeof i18nTranslators.$inferInsert;
