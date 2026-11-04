const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceUrl, publicAddress, fetchPublicSource } = require('../public-source.cjs');

test('source URLs reject local, credentialed, non-HTTPS and IP targets', () => {
  for (const value of ['http://example.org/a', 'https://localhost/a', 'https://foo.local/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://user:pass@example.org/a', 'https://example.org:8443/a', 'https://2130706433/a']) assert.equal(sourceUrl(value), null, value);
  assert.equal(sourceUrl('https://reissuerecords.net/2026/11/04/news/#a').href, 'https://reissuerecords.net/2026/11/04/news/');
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
});

test('source fetch rejects private and mixed DNS answers before making an HTTP connection', async () => {
  for (const answers of [[{ address: '127.0.0.1' }], [{ address: '8.8.8.8' }, { address: '10.0.0.1' }], []]) {
    await assert.rejects(fetchPublicSource('https://untrusted.org/news', {}, async () => answers), /公開ネットワーク/);
  }
});
