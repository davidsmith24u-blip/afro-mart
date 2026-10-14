// Display-only multi-currency support for the European diaspora. Prices are
// stored and charged in EUR (the base currency); these rates let the storefront
// show a familiar figure in the shopper's own currency. Rates are approximate
// and intentionally static so there is no external dependency.

export const BASE_CURRENCY = 'EUR';

export const CURRENCIES = [
  { code: 'EUR', symbol: '€', rate: 1, locale: 'de-DE', label: 'Euro' },
  { code: 'GBP', symbol: '£', rate: 0.85, locale: 'en-GB', label: 'British Pound' },
  { code: 'CHF', symbol: 'CHF', rate: 0.95, locale: 'de-CH', label: 'Swiss Franc' },
  { code: 'SEK', symbol: 'kr', rate: 11.3, locale: 'sv-SE', label: 'Swedish Krona' },
  { code: 'NOK', symbol: 'kr', rate: 11.7, locale: 'nb-NO', label: 'Norwegian Krone' },
  { code: 'DKK', symbol: 'kr', rate: 7.46, locale: 'da-DK', label: 'Danish Krone' },
  { code: 'PLN', symbol: 'zł', rate: 4.3, locale: 'pl-PL', label: 'Polish Złoty' },
  { code: 'CZK', symbol: 'Kč', rate: 25.3, locale: 'cs-CZ', label: 'Czech Koruna' },
  { code: 'USD', symbol: '$', rate: 1.08, locale: 'en-US', label: 'US Dollar' },
  { code: 'CAD', symbol: 'CA$', rate: 1.47, locale: 'en-CA', label: 'Canadian Dollar' },
];

export function currencyList() {
  return CURRENCIES.map(({ code, symbol, rate, locale, label }) => ({ code, symbol, rate, locale, label }));
}
