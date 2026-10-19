import { describe, expect, it } from 'vitest';
import { refusalOf } from './refusal';

/** better-auth answers « Invalid email or password ». The page is in French (DB-239). */
describe('what a refused sign-in says', () => {
  it('names the refusal by its status, never by the message of the library', () => {
    expect(refusalOf({ status: 401 }, 'x')).toBe('Adresse ou mot de passe refusé.');
    expect(refusalOf({ status: 429 }, 'x')).toBe("Trop d'essais. Réessayez dans quelques minutes.");
  });

  it('falls back to the sentence of the caller for a status it does not know', () => {
    expect(refusalOf({ status: 500 }, 'La connexion a échoué.')).toBe('La connexion a échoué.');
    expect(refusalOf({}, 'La connexion a échoué.')).toBe('La connexion a échoué.');
  });
});
