// Display-only multi-currency support for the European diaspora. Prices are
// stored and charged in EUR (the base currency); these rates let the storefront
// show a familiar figure in the shopper's own currency. Rates are approximate
// and intentionally static so there is no external dependency.

export const BASE_CURRENCY = 'EUR';

export const CURRENCIES = [
  { code: 'EUR', symbol: '€', rate: 1, locale: 'de-DE', label: 'Euro' },
  { code: 'USD', symbol: '$', rate: 1.08, locale: 'en-US', label: 'US Dollar' },
  { code: 'GBP', symbol: '£', rate: 0.85, locale: 'en-GB', label: 'British Pound' },
];

export function currencyList() {
  return CURRENCIES.map(({ code, symbol, rate, locale, label }) => ({ code, symbol, rate, locale, label }));
}
