import type { i18nRepositories, members } from './schema';

export type I18nRepository = typeof i18nRepositories.$inferSelect;
export type NewI18nRepository = typeof i18nRepositories.$inferInsert;

export type Member = typeof members.$inferSelect;
