"""Check the deployed landing's HTTP contract without third-party dependencies.

Run against the static container: python scripts/check_static_security.py http://localhost:4180
"""
import gzip
import json
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

base = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000').rstrip('/')


def request(path, method='GET', headers=None):
    try:
        response = urlopen(Request(base + path, method=method, headers=headers or {}), timeout=15)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


for attempt in range(30):
    try:
        if request('/healthz')[0] == 200:
            break
    except (URLError, ConnectionError):
        pass
    time.sleep(.1)
else:
    raise RuntimeError('El contenedor no respondió en /healthz.')

status, headers, html = request('/')
assert status == 200
assert headers['Cache-Control'] == 'no-cache'
assert headers['X-Content-Type-Options'] == 'nosniff'
assert headers['X-Frame-Options'] == 'DENY'
assert "frame-ancestors 'none'" in headers['Content-Security-Policy']
assert "script-src 'self'" in headers['Content-Security-Policy']
assert headers.get('Server') is None
assert headers['Referrer-Policy'] == 'strict-origin-when-cross-origin'
for path in ['/api/health', '/api/customers', '/api/quotes', '/api/quote-drafts/analyze',
             '/api/visual-proposals', '/app', '/app/precios', '/propuesta-visual',
             '/.env', '/%2eenv', '/.git/config', '/Dockerfile', '/server/package.json',
             '/secuencias/joker/clip-01/frame-001.webp', '/assets/../../.env']:
    assert request(path)[0] == 404, path
assert request('/api/visual-proposals', method='POST')[0] == 404
assert request('/', method='POST')[0] == 405
assert request('/healthz')[0] == 200
assert request('/pagina-inexistente')[0] == 404
for path in ['/catalogo', '/servicios/letreros', '/servicios/letras-3d',
             '/servicios/gran-formato', '/servicios/viniles', '/servicios/senaletica',
             '/servicios/eventos', '/nosotros', '/contacto', '/politica-privacidad']:
    status, headers, body = request(path)
    assert status == 200 and b'index,follow' in body, path
    assert request(path + '/')[0] == 200, path
assert request('/sequence-cache-sw.js')[1]['Cache-Control'] == 'no-cache'
asset = re.search(rb'src="(/assets/[^\"]+\.js)"', html).group(1).decode()
status, headers, compressed = request(asset, headers={'Accept-Encoding': 'gzip'})
assert status == 200 and headers['Content-Encoding'] == 'gzip'
assert 'immutable' in headers['Cache-Control']
assert b'/visual-proposals' not in gzip.decompress(compressed)
assert 'Accept-Encoding' in headers['Vary']
assert request(asset, headers={'If-None-Match': headers['ETag'], 'Accept-Encoding': 'gzip'})[0] == 304
manifest = json.loads((Path(__file__).resolve().parents[1] / 'src/config/sequenceBundles.json').read_text())
for variant in ['desktop', 'mobile']:
    pack = manifest[variant][0]
    status, headers, body = request(pack['url'], method='HEAD')
    assert status == 200 and int(headers['Content-Length']) == pack['bytes']
    assert 'immutable' in headers['Cache-Control'] and not body
    status, _, body = request(pack['url'], headers={'Range': 'bytes=0-7'})
    assert status == 206 and body == b'JSEQ001\n'
assert request('/secuencias/joker/clip-03/frame-192.webp')[0] == 200
print('PASS: public pages, security headers, private route isolation, traversal/dotfiles, methods, gzip, cache revalidation, packs and reduced-motion still.')
