/**
 * The example repository of the demo: an online shop that translates its
 * English texts into German and French.
 */

export const REPOSITORY = { id: 'demo-acme-shop', owner: 'acme', name: 'shop', branch: 'main' } as const;

export const SOURCE = 'en';

/** German first: the editor opens the first target, and the agent of the home page writes German. */
export const TARGETS = ['de', 'fr'] as const;

export type Target = (typeof TARGETS)[number];

/** `file` then `key` then the text of each language. A missing language is a missing translation. */
type Row = [file: string, key: string, texts: { en: string; de?: string; fr?: string }];

const ROWS: Row[] = [
  ['common', 'nav.home', { en: 'Home', de: 'Startseite', fr: 'Accueil' }],
  ['common', 'nav.catalogue', { en: 'Catalogue', de: 'Katalog', fr: 'Catalogue' }],
  ['common', 'nav.cart', { en: 'Cart', de: 'Warenkorb', fr: 'Panier' }],
  ['common', 'nav.account', { en: 'My account', de: 'Mein Konto', fr: 'Mon compte' }],
  ['common', 'actions.save', { en: 'Save', de: 'Speichern', fr: 'Enregistrer' }],
  ['common', 'actions.cancel', { en: 'Cancel', de: 'Abbrechen', fr: 'Annuler' }],
  ['common', 'actions.search', { en: 'Search the shop', fr: 'Rechercher dans la boutique' }],
  ['common', 'footer.legal', { en: 'Legal notice', de: 'Impressum', fr: 'Mentions légales' }],
  ['common', 'footer.contact', { en: 'Contact us', fr: 'Nous contacter' }],
  ['common', 'errors.offline', { en: 'You are offline. We will try again.' }],
  ['checkout', 'title', { en: 'Checkout', de: 'Kasse', fr: 'Paiement' }],
  ['checkout', 'summary.items', { en: '{{count}} items', de: '{{count}} Artikel', fr: '{{count}} articles' }],
  ['checkout', 'summary.shipping', { en: 'Shipping', de: 'Versand', fr: 'Livraison' }],
  ['checkout', 'summary.total', { en: 'Total', de: 'Gesamt', fr: 'Total' }],
  ['checkout', 'address.title', { en: 'Delivery address', fr: 'Adresse de livraison' }],
  [
    'checkout',
    'address.same',
    { en: 'Use the same address for the invoice', fr: 'Utiliser la même adresse pour la facture' },
  ],
  ['checkout', 'pay', { en: 'Pay now', de: 'Jetzt bezahlen', fr: 'Payer' }],
  ['checkout', 'pay.secure', { en: 'Your payment is encrypted.', fr: 'Votre paiement est chiffré.' }],
  ['checkout', 'errors.card', { en: 'The bank refused the card. Try another one.' }],
  [
    'checkout',
    'done',
    { en: 'Thank you! Your order {{number}} is on its way.', fr: 'Merci ! Votre commande {{number}} est en route.' },
  ],
  ['account', 'title', { en: 'My account', de: 'Mein Konto', fr: 'Mon compte' }],
  ['account', 'orders.title', { en: 'My orders', de: 'Meine Bestellungen', fr: 'Mes commandes' }],
  ['account', 'orders.empty', { en: 'No order yet.', fr: 'Aucune commande pour le moment.' }],
  ['account', 'orders.track', { en: 'Track the parcel', fr: 'Suivre le colis' }],
  ['account', 'profile.name', { en: 'Full name', de: 'Vollständiger Name', fr: 'Nom complet' }],
  ['account', 'profile.email', { en: 'Email address', de: 'E-Mail-Adresse', fr: 'Adresse e-mail' }],
  ['account', 'profile.saved', { en: 'Your profile is saved.', fr: 'Votre profil est enregistré.' }],
  ['account', 'password.change', { en: 'Change the password', fr: 'Changer le mot de passe' }],
  ['account', 'sign-out', { en: 'Sign out', de: 'Abmelden', fr: 'Se déconnecter' }],
  ['account', 'delete', { en: 'Delete my account', fr: 'Supprimer mon compte' }],
];

export interface SourceEntry {
  file: string;
  key: string;
  source: string;
}

export const sourceEntries = (): SourceEntry[] => ROWS.map(([file, key, texts]) => ({ file, key, source: texts.en }));

export const publishedIn = (language: Target): Array<{ file: string; key: string; value: string }> =>
  ROWS.flatMap(([file, key, texts]) => (texts[language] === undefined ? [] : [{ file, key, value: texts[language] }]));

/**
 * A French translation whose English source changed after it was written.
 * The editor shows it under « À relire ».
 */
export const REVIEW = { language: 'fr', file: 'checkout', key: 'pay', was: 'Pay' } as const;

/** A batch of another translator that waits for a reviewer. */
export const WAITING = {
  language: 'fr' as Target,
  author: 'Léa Martin',
  values: [
    { file: 'common', key: 'errors.offline', value: 'Vous êtes hors ligne. Nous réessayons.' },
    { file: 'checkout', key: 'errors.card', value: 'La banque a refusé la carte. Essayez-en une autre.' },
  ],
};

/** What the agent of the home page proposes in German, for the keys that are still missing. */
export const AGENT_GERMAN: Record<string, string> = {
  'common\nactions.search': 'Im Shop suchen',
  'common\nfooter.contact': 'Kontakt',
  'common\nerrors.offline': 'Sie sind offline. Wir versuchen es erneut.',
  'checkout\naddress.title': 'Lieferadresse',
  'checkout\naddress.same': 'Dieselbe Adresse für die Rechnung verwenden',
  'checkout\npay.secure': 'Ihre Zahlung ist verschlüsselt.',
  'checkout\nerrors.card': 'Die Bank hat die Karte abgelehnt. Versuchen Sie eine andere.',
  'checkout\ndone': 'Danke! Ihre Bestellung {{number}} ist unterwegs.',
  'account\norders.empty': 'Noch keine Bestellung.',
  'account\norders.track': 'Paket verfolgen',
  'account\nprofile.saved': 'Ihr Profil ist gespeichert.',
  'account\npassword.change': 'Passwort ändern',
  'account\ndelete': 'Mein Konto löschen',
};

export const ACCOUNT = { id: 'demo-account', name: 'Camille Laurent', email: 'camille@example.com' } as const;

export const AGENT_AUTHOR = 'Agent (git8n CLI)';
