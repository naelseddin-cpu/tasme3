#!/usr/bin/env python3
"""Serve the Quran explorer from this PC, with the wisdom chat answered by this PC.

    python3 quran-research/server.py [--port 8000] [--host 0.0.0.0] [--local-llm http://127.0.0.1:8092]

GET  /             static files from quran-research/explorer/
GET  /api/health   {"ok", "engine": "claude"|"local", "name"} for this visitor
POST /api/unlock   {"password"} -> sets a cookie that switches this browser to Claude
POST /api/sample   {"system", "prompt"} -> streams the reply as plain text

Two engines:
  claude  the Claude CLI on this PC (no tools, no MCP, no settings: text only). Used for
          the owner only: requests from this PC / the home network, or with the password
          cookie. The password is in quran-research/.chat-password (created on first run).
  local   an OpenAI-compatible server on this PC (llama.cpp's llama-server with Gemma),
          used for everyone else, e.g. visitors arriving through a Cloudflare tunnel.
          One public request runs at a time; extra ones get 429.
Verse lookups always run in the visitor's browser (index.html's TOOLS); the model only
writes text.
"""
import argparse, hashlib, hmac, ipaddress, json, os, secrets, shutil, subprocess, tempfile, threading
import urllib.request
from functools import partial
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'explorer')
PW_FILE = os.path.join(HERE, '.chat-password')
CLAUDE = shutil.which('claude')
MAX_BODY = 400_000
WORKDIR = tempfile.mkdtemp(prefix='quran-chat-')
LOCAL_LLM = 'http://127.0.0.1:8092'
PUBLIC_SLOT = threading.Semaphore(1)


def load_password():
    if not os.path.exists(PW_FILE):
        with open(os.open(PW_FILE, os.O_WRONLY | os.O_CREAT, 0o600), 'w') as f:
            f.write(secrets.token_urlsafe(9) + '\n')
    return open(PW_FILE).read().strip()


PASSWORD = load_password()
TOKEN = hmac.new(PASSWORD.encode(), b'quran-explorer-owner', hashlib.sha256).hexdigest()


def is_private(host):
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return host == 'localhost'


class Handler(SimpleHTTPRequestHandler):
    # index.html is an artifact page without <meta charset>, so the header must say UTF-8
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
                      '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'}

    def log_message(self, fmt, *args):
        if self.path.startswith('/api/'):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def owner(self):
        """This PC / home network (not via a tunnel), or a browser that knows the password."""
        c = SimpleCookie(self.headers.get('Cookie') or '').get('qx_owner')
        if c and hmac.compare_digest(c.value, TOKEN):
            return True
        if self.headers.get('Cf-Connecting-Ip') or self.headers.get('X-Forwarded-For'):
            return False  # arrived through a tunnel/proxy
        host = (self.headers.get('Host') or '').rsplit(':', 1)[0].strip('[]')
        return is_private(self.client_address[0]) and is_private(host)

    def engine(self):
        return 'claude' if CLAUDE and self.owner() else 'local'

    def do_GET(self):
        if self.path == '/api/health':
            e = self.engine()
            return self._json(200, {'ok': True, 'engine': e, 'name': 'Claude' if e == 'claude' else 'Gemma'})
        super().do_GET()

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            return self._json(413, {'error': 'prompt_too_large'})
        try:
            body = json.loads(self.rfile.read(n))
        except Exception:
            return self._json(400, {'error': 'bad request'})
        if self.path == '/api/unlock':
            if not hmac.compare_digest(str(body.get('password', '')).encode(), PASSWORD.encode()):
                return self._json(403, {'ok': False})
            return self._json(200, {'ok': True}, cookie=f'qx_owner={TOKEN}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict')
        if self.path != '/api/sample':
            return self._json(404, {'error': 'not found'})
        prompt, system = str(body.get('prompt') or ''), str(body.get('system') or '')
        if self.engine() == 'claude':
            return self._stream(self._claude(prompt, system))
        if not PUBLIC_SLOT.acquire(blocking=False):
            return self._json(429, {'error': 'rate_limited'})
        try:
            self._stream(self._local(prompt, system))
        finally:
            PUBLIC_SLOT.release()

    def _claude(self, prompt, system):
        cmd = [CLAUDE, '-p', '--tools', '', '--output-format', 'stream-json',
               '--include-partial-messages', '--verbose', '--no-session-persistence',
               '--setting-sources', '', '--strict-mcp-config']
        if system:
            cmd += ['--system-prompt', system]
        proc = subprocess.Popen(cmd, cwd=WORKDIR, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, text=True, encoding='utf-8')
        proc.stdin.write(prompt)
        proc.stdin.close()
        try:
            for line in proc.stdout:
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                if ev.get('type') == 'stream_event':
                    d = ev['event'].get('delta') or {}
                    if d.get('type') == 'text_delta' and d.get('text'):
                        yield d['text']
                elif ev.get('type') == 'result' and ev.get('is_error'):
                    raise RuntimeError(ev.get('result') or 'error')
            proc.wait()
        finally:
            if proc.poll() is None:
                proc.kill()

    def _local(self, prompt, system):
        msgs = ([{'role': 'system', 'content': system}] if system else []) + [{'role': 'user', 'content': prompt}]
        req = urllib.request.Request(LOCAL_LLM + '/v1/chat/completions', headers={'Content-Type': 'application/json'},
                                     data=json.dumps({'messages': msgs, 'stream': True, 'max_tokens': 4000,
                                                      'temperature': 0.4,
                                                      # no silent thinking: a tunnel drops a request
                                                      # that sends nothing for 100 s
                                                      'chat_template_kwargs': {'enable_thinking': False}}).encode())
        with urllib.request.urlopen(req, timeout=600) as r:
            for line in r:  # SSE; only the answer, never reasoning_content
                line = line.decode('utf-8', 'replace').strip()
                if not line.startswith('data:') or line == 'data: [DONE]':
                    continue
                try:
                    t = json.loads(line[5:])['choices'][0]['delta'].get('content')
                except (ValueError, KeyError, IndexError):
                    continue
                if t:
                    yield t

    def _stream(self, gen):
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Connection', 'close')  # HTTP/1.0: the body ends when we close
        self.end_headers()
        got = False
        try:
            try:
                for t in gen:
                    got = True
                    self.wfile.write(t.encode('utf-8'))
                    self.wfile.flush()
                if not got:
                    raise RuntimeError('no output')
            except (BrokenPipeError, ConnectionResetError):
                raise
            except Exception as e:
                self.log_message('engine error: %s', e)
                self.wfile.write(('\n<<ERROR:%s>>' % e).encode('utf-8'))
        except (BrokenPipeError, ConnectionResetError):
            pass  # browser pressed stop / closed the tab
        finally:
            gen.close()

    def _json(self, code, obj, cookie=None):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(b)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='0.0.0.0')
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--local-llm', default=LOCAL_LLM, help='OpenAI-compatible server for public visitors')
    a = ap.parse_args()
    LOCAL_LLM = a.local_llm.rstrip('/')
    print(f'Quran explorer on http://{a.host}:{a.port}  claude CLI: {CLAUDE or "NOT FOUND"}  local LLM: {LOCAL_LLM}', flush=True)
    print(f'Owner password (unlocks Claude from outside): {PW_FILE}', flush=True)
    ThreadingHTTPServer((a.host, a.port), partial(Handler, directory=ROOT)).serve_forever()
