// Global-reach tests: every locale must define every string key, and the
// storefront currency switcher is config-driven.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, STRING_KEYS, translate, makeT } from '../public/i18n.js';
import { currencyList, BASE_CURRENCY } from '../src/currencies.js';

test('i18n: every locale defines every key', () => {
  assert.deepEqual(LOCALES, ['en', 'de', 'fr']);
  assert.ok(STRING_KEYS.length > 80);
  for (const locale of LOCALES) {
    for (const key of STRING_KEYS) {
      const text = translate(locale, key);
      assert.ok(text && text !== key, `${locale} is missing "${key}"`);
    }
  }
});

test('i18n: interpolation and safe fallback', () => {
  assert.equal(translate('en', 'cart.items', { n: 3 }), '3 items in your bag');
  assert.equal(translate('de', 'cart.items', { n: 3 }), '3 Artikel in deiner Tasche');
  assert.equal(translate('fr', 'cart.item', { n: 1 }), '1 article dans votre panier');
  // Unknown locale falls back to English; unknown key returns the key.
  assert.equal(translate('xx', 'hero.title'), 'Every pot tells a story.');
  assert.equal(translate('en', 'nope.key'), 'nope.key');
  assert.equal(makeT('de')('cart.ready'), 'Bereit, wenn du es bist');
});

test('currencies: base currency first and rates sane for the diaspora', () => {
  const list = currencyList();
  assert.equal(BASE_CURRENCY, 'EUR');
  assert.equal(list[0].code, 'EUR');
  assert.equal(list[0].rate, 1);
  for (const currency of list) {
    assert.ok(currency.rate > 0);
    assert.ok(currency.symbol && currency.locale);
  }
  assert.ok(list.some((c) => c.code === 'GBP') && list.some((c) => c.code === 'USD'));
});
