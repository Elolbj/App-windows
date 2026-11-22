"""Tests du serveur local : jeton, en-tête Host, fichiers statiques, API en mode démo."""

import json
import urllib.error
import urllib.request

import pytest

from pcinsight.api import TTL, Api, build_collectors
from pcinsight.collectors.performance import Sampler
from pcinsight.history import History
from pcinsight.server import AppServer
from pcinsight.store import Store
from pcinsight.winutil import resource_dir


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    history = History(tmp_path_factory.mktemp("db") / "h.db")
    sampler = Sampler(interval=0.2, on_sample=history.add)
    srv = AppServer(Api(Store(build_collectors(True), TTL), sampler, history, demo_mode=True), resource_dir() / "web")
    srv.start()
    sampler.start()
    yield srv
    sampler.stop()
    srv.stop()
    history.close()


def call(srv, path, token=True, host=None, method="GET", body=None):
    req = urllib.request.Request(f"http://127.0.0.1:{srv.port}{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    if token:
        req.add_header("X-Token", srv.token)
    if host:
        req.add_header("Host", host)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def test_api_requires_token(server):
    assert call(server, "/api/status", token=False)[0] == 403


def test_foreign_host_rejected(server):
    assert call(server, "/api/status", host="attacker.example")[0] == 421


def test_static_files_and_headers(server):
    status, headers, body = call(server, "/", token=False)
    assert status == 200 and b"PC Insight" in body
    assert "script-src 'self'" in headers["Content-Security-Policy"]
    status, headers, _ = call(server, "/js/main.js", token=False)
    assert status == 200 and headers["Content-Type"].startswith("text/javascript")


def test_path_traversal_blocked(server):
    assert call(server, "/../api.py", token=False)[0] == 404
    assert call(server, "/%2e%2e/api.py", token=False)[0] == 404


def test_sections_and_analysis(server):
    for name in ("system", "hardware", "software", "security", "events", "updates", "storage", "network"):
        status, _, body = call(server, f"/api/{name}")
        data = json.loads(body)
        assert status == 200 and data["data"] is not None, name
    status, _, body = call(server, "/api/analysis")
    assert status == 200 and 0 <= json.loads(body)["score"] <= 100


def test_unknown_route(server):
    assert call(server, "/api/nope")[0] == 404
    assert call(server, "/api/export", method="GET")[0] == 404  # export uniquement en POST
