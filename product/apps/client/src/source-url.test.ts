import { expect, it } from 'vitest';
import { safeSourceUrl } from './domain';

it('allows only the two exact reviewed HTTPS source hosts', () => {
  expect(safeSourceUrl('https://iba-world.com/iba-cocktail/negroni/')).toBe('https://iba-world.com/iba-cocktail/negroni/');
  expect(safeSourceUrl('https://www.thecocktaildb.com/drink/17254')).toBe('https://www.thecocktaildb.com/drink/17254');
  for (const url of [
    'http://www.thecocktaildb.com/drink/17254',
    'https://www.thecocktaildb.com.attacker.example/drink/17254',
    'https://thecocktaildb.com/drink/17254',
    'https://www.thecocktaildb.com:444/drink/17254',
    'https://user:pass@www.thecocktaildb.com/drink/17254',
    'javascript:alert(1)', 'file:///C:/private', '//www.thecocktaildb.com/drink/17254',
  ]) expect(safeSourceUrl(url)).toBeNull();
});
