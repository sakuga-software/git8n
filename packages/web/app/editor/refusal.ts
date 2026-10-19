/**
 * What a refused sign-in says, in the language of the page.
 *
 * better-auth answers in English (« Invalid email or password »). Its message
 * is not shown: the status says enough to choose a sentence.
 */
export const refusalOf = (error: { status?: number }, fallback: string): string => {
  if (error.status === 401 || error.status === 403) return 'Adresse ou mot de passe refusé.';
  if (error.status === 429) return "Trop d'essais. Réessayez dans quelques minutes.";

  return fallback;
};
