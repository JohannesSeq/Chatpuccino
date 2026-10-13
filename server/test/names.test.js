import test from 'node:test';
import assert from 'node:assert/strict';
import { fillNames } from '../../shared/names.js';

test('fillNames sustituye {{user}} y {{char}} (con espacios, mayúsculas y formas antiguas)', () => {
  const out = fillNames('Hola {{user}}, soy {{ Char }}. <USER> y <BOT>; {{random:a,b}}', { user: 'Ana', char: 'Luna' });
  assert.equal(out, 'Hola Ana, soy Luna. Ana y Luna; {{random:a,b}}');
  assert.equal(fillNames('{{user}}', { char: 'Luna' }), '{{user}}', 'sin nombre no se toca');
  assert.equal(fillNames('$& {{char}}', { char: '$&' }), '$& $&', 'el nombre se inserta literal');
  assert.equal(fillNames(undefined, { user: 'x' }), undefined);
});
