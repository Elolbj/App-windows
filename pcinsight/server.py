"""Serveur HTTP local qui sert l'interface web et l'API JSON.

Sécurité :
- écoute uniquement sur 127.0.0.1, port aléatoire ;
- chaque appel /api exige un jeton aléatoire (en-tête X-Token), connu seulement de la fenêtre ;
- l'en-tête Host est vérifié (protection contre le DNS rebinding) ;
- aucune requête cross-origin n'est autorisée (pas d'en-têtes CORS) ;
- Content-Security-Policy stricte : pas de script inline, rien de chargé depuis Internet.
"""

import json
import logging
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

log = logging.getLogger(__name__)

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
# Table explicite : sous Windows, mimetypes lit le registre et peut renvoyer
# text/plain pour .js, ce qui empêche le chargement des modules JavaScript.
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
}


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class AppServer:
    def __init__(self, api, web_root: Path, port=0):
        self.api = api                   # objet exposant handle(method, path, query, body)
        self.web_root = Path(web_root).resolve()
        self.token = secrets.token_urlsafe(32)
        handler = self._make_handler()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.allowed_hosts = {f"127.0.0.1:{self.port}", f"localhost:{self.port}"}
        self._thread = None

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}/#token={self.token}"

    def start(self):
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True, name="http")
        self._thread.start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def _make_handler(self):
        server = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "PCInsight"
            sys_version = ""

            def log_message(self, fmt, *args):  # pas de journal console par requête
                log.debug("%s - %s", self.address_string(), fmt % args)

            # ---------------------------------------------------------- utilitaires
            def _send(self, status, body: bytes, ctype, extra=None):
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Content-Security-Policy", CSP)
                self.send_header("Cache-Control", "no-store")
                for k, v in (extra or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)

            def _json(self, status, obj):
                body = json.dumps(obj, ensure_ascii=False, default=str, separators=(",", ":")).encode("utf-8")
                self._send(status, body, "application/json; charset=utf-8")

            def _host_ok(self):
                return self.headers.get("Host", "") in server.allowed_hosts

            # ---------------------------------------------------------- routes
            def do_HEAD(self):
                self.do_GET()

            def do_GET(self):
                self._dispatch("GET")

            def do_POST(self):
                self._dispatch("POST")

            def _dispatch(self, method):
                if not self._host_ok():
                    return self._send(421, b"Misdirected request", "text/plain")
                url = urlparse(self.path)
                if url.path.startswith("/api/"):
                    return self._api(method, url)
                if method != "GET" and self.command != "HEAD":
                    return self._send(405, b"Method not allowed", "text/plain")
                return self._static(url.path)

            def _api(self, method, url):
                if not secrets.compare_digest(self.headers.get("X-Token", ""), server.token):
                    return self._json(403, {"error": "Jeton invalide"})
                body = None
                if method == "POST":
                    length = min(int(self.headers.get("Content-Length") or 0), 1_000_000)
                    raw = self.rfile.read(length) if length else b""
                    try:
                        body = json.loads(raw) if raw else {}
                    except json.JSONDecodeError:
                        return self._json(400, {"error": "JSON invalide"})
                query = {k: v[-1] for k, v in parse_qs(url.query).items()}
                try:
                    result = server.api.handle(method, url.path[len("/api/"):], query, body)
                    self._json(200, result)
                except ApiError as exc:
                    self._json(exc.status, {"error": str(exc)})
                except Exception as exc:  # erreur inattendue : on la journalise
                    log.exception("Erreur API %s", url.path)
                    self._json(500, {"error": str(exc)})

            def _static(self, path):
                rel = path.lstrip("/") or "index.html"
                target = (server.web_root / rel).resolve()
                # empêche la sortie du dossier web (../../)
                if server.web_root not in target.parents and target != server.web_root:
                    return self._send(404, b"Not found", "text/plain")
                if target.is_dir():
                    target = target / "index.html"
                if not target.is_file():
                    return self._send(404, b"Not found", "text/plain")
                ctype = CONTENT_TYPES.get(target.suffix.lower(), "application/octet-stream")
                self._send(200, target.read_bytes(), ctype)

        return Handler
