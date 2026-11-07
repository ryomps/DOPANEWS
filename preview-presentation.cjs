const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const assets = new Map([
  ['/', ['presentation.html', 'text/html; charset=utf-8']],
  ['/demo.mp4', ['demo.mp4', 'video/mp4']],
  ...['css/images/news-sns-safety-freedom.png', 'css/images/dopanews-header-logo-v3.png',
    '.local/slide-refresh/battle.png', '.local/slide-refresh/battle-reina.png']
    .map(file => ['/' + file, [file, 'image/png']])
]);

http.createServer((req, res) => {
  const asset = assets.get(req.url.split('?')[0]);
  if (!asset || !['GET', 'HEAD'].includes(req.method)) return res.writeHead(404).end();
  const [file, mime] = asset;
  const fullPath = path.join(__dirname, file);
  fs.stat(fullPath, (error, stats) => {
    if (error) return res.writeHead(404).end();
    const headers = { 'Content-Type': mime, 'Content-Length': stats.size };
    const range = mime === 'video/mp4' && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    let bounds;
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), stats.size - 1) : stats.size - 1;
      if (start > end) return res.writeHead(416, { 'Content-Range': 'bytes */' + stats.size }).end();
      bounds = { start, end };
      headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stats.size;
      headers['Content-Length'] = end - start + 1;
    }
    if (mime === 'video/mp4') headers['Accept-Ranges'] = 'bytes';
    res.writeHead(bounds ? 206 : 200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(fullPath, bounds);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}).listen(8082, '127.0.0.1', () => console.log('http://127.0.0.1:8082/'));
