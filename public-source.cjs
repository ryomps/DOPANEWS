const dns = require('node:dns/promises');
const https = require('node:https');
const { BlockList, isIP } = require('node:net');
const { Readable } = require('node:stream');

// Search results are untrusted. Never let a source URL reach the local network.
const blocked = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(network, prefix);
function sourceUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || isIP(u.hostname) || u.hostname.startsWith('[') || !u.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(u.hostname) || u.hostname.endsWith('.')) return null;
    u.hash = ''; return u;
  } catch { return null; }
}
function publicAddress(address) { return isIP(address) === 4 && !blocked.check(address, 'ipv4'); }
async function fetchPublicSource(value, { signal, headers } = {}, lookup = dns.lookup) {
  const url = sourceUrl(value);
  if (!url) throw new Error('公開HTTPS資料のURLではありません。');
  // Pin a checked IPv4 result for the actual TLS connection to prevent DNS rebinding.
  const addresses = await lookup(url.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('公開ネットワーク以外の資料は取得しません。');
  return new Promise((resolve, reject) => {
    const request = https.get(url, { signal, headers, lookup: (_host, options, callback) => {
      if (options.all) callback(null, [{ address: addresses[0].address, family: 4 }]);
      else callback(null, addresses[0].address, 4);
    } }, response => {
      // No redirect following, cookies, credentials, or browser script execution.
      const responseHeaders = new Headers();
      for (const [key, val] of Object.entries(response.headers)) if (val !== undefined) responseHeaders.set(key, Array.isArray(val) ? val.join(', ') : val);
      const status = response.statusCode;
      if (status >= 300 && status < 400) { response.destroy(); reject(new Error('転送先の資料は自動取得しません。')); return; }
      const noBody = [204, 205, 304].includes(status);
      if (noBody) response.resume();
      resolve(new Response(noBody ? null : Readable.toWeb(response), { status, headers: responseHeaders }));
    });
    request.on('error', reject);
  });
}
module.exports = { sourceUrl, publicAddress, fetchPublicSource };
