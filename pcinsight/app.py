"""Point d'entrée : lance la collecte, le serveur local et la fenêtre de l'application."""

import argparse
import logging
import logging.handlers
import signal
import sys
import threading
import webbrowser

from . import APP_NAME, __version__
from .api import TTL, Api, build_collectors, storage_snapshot_loop
from .collectors.performance import Sampler
from .collectors.sensors import SensorHub
from .history import History
from .server import AppServer
from .settings import Settings
from .store import Store
from .winutil import HKCU, IS_WINDOWS, app_data_dir, reg_value, resource_dir

log = logging.getLogger("pcinsight")


def setup_logging(debug=False):
    path = app_data_dir() / "pcinsight.log"
    handler = logging.handlers.RotatingFileHandler(path, maxBytes=1_000_000, backupCount=2, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.DEBUG if debug else logging.INFO)
    if debug and sys.stderr:  # sys.stderr vaut None dans un exe sans console
        root.addHandler(logging.StreamHandler())


def parse_args(argv):
    p = argparse.ArgumentParser(prog="pcinsight", description=f"{APP_NAME} {__version__}")
    p.add_argument("--demo", action="store_true", help="utiliser des données de démonstration")
    p.add_argument("--browser", action="store_true", help="ouvrir dans le navigateur au lieu d'une fenêtre")
    p.add_argument("--no-open", action="store_true", help="ne rien ouvrir (affiche seulement l'adresse)")
    p.add_argument("--port", type=int, default=0, help="port local (aléatoire par défaut)")
    p.add_argument("--debug", action="store_true", help="journal détaillé et outils de développement")
    p.add_argument("--collect", action="store_true",
                   help="collecte l'historique en arrière-plan, sans interface")
    p.add_argument("--selftest", action="store_true", help="teste chaque collecteur puis quitte")
    p.add_argument("--out", help="fichier JSON de résultat pour --selftest")
    return p.parse_args(argv)


def run_collector_only():
    """Mode --collect : à lancer à l'ouverture de session (Planificateur de tâches)
    pour avoir un historique de performances même quand la fenêtre est fermée."""
    history = History(app_data_dir() / "history.db")
    hub = SensorHub(Settings(app_data_dir() / "settings.json"), interval=10.0)
    sampler = Sampler(interval=5.0, on_sample=history.add, sensor_value=hub.value)
    hub.counters_source = sampler.last_counters
    hub.start()
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    sampler.start()
    threading.Thread(target=storage_snapshot_loop, args=(history, stop), daemon=True).start()
    log.info("Collecte en arrière-plan démarrée")
    _wait(stop)
    sampler.stop()
    sampler.join(timeout=10)
    history.close()
    return 0


def open_window(url, debug):
    """Fenêtre native (WebView2 via pywebview). Renvoie False si pywebview est absent."""
    try:
        import webview
    except ImportError:
        log.warning("pywebview absent : ouverture dans le navigateur")
        return False
    # fond de la fenêtre assorti au thème Windows (évite un flash au chargement)
    light = reg_value(HKCU, r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1)
    webview.create_window(APP_NAME, url, width=1400, height=880, min_size=(980, 620),
                          background_color="#f9f9f7" if light else "#0d0d0d")
    storage = str(app_data_dir() / "webview")
    try:  # garde le thème choisi (localStorage) d'une session à l'autre
        webview.start(debug=debug, private_mode=False, storage_path=storage)
    except TypeError:  # anciennes versions de pywebview
        webview.start(debug=debug)
    return True


def _wait(event):
    # boucle courte : sous Windows, Event.wait() sans délai ignore Ctrl+C
    while not event.wait(0.5):
        pass


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    setup_logging(args.debug)

    if args.selftest:
        from .selftest import run
        return run(args.out)
    if args.collect:
        return run_collector_only()

    demo_mode = args.demo or not IS_WINDOWS
    settings = Settings(app_data_dir() / "settings.json")
    history = History(app_data_dir() / "history.db")
    hub = SensorHub(settings, demo=demo_mode)
    counters_factory = None
    if not IS_WINDOWS:
        from .demo import DemoCounters
        counters_factory = DemoCounters
    sampler = Sampler(interval=2.0, on_sample=history.add, sensor_value=hub.value, counters_factory=counters_factory)
    hub.counters_source = sampler.last_counters
    store = Store(build_collectors(args.demo), TTL)
    stop = threading.Event()

    def quit_app():
        stop.set()
        try:
            import webview
            for w in list(webview.windows):
                w.destroy()
        except Exception:
            pass

    api = Api(store, sampler, history, demo_mode=args.demo, on_quit=quit_app, hub=hub, settings=settings)
    server = AppServer(api, resource_dir() / "web", port=args.port)
    server.start()
    sampler.start()
    hub.start()
    store.prefetch()
    threading.Thread(target=storage_snapshot_loop, args=(history, stop), daemon=True).start()
    log.info("%s %s sur http://127.0.0.1:%s (démo=%s)", APP_NAME, __version__, server.port, api.demo)

    try:
        if args.no_open:
            print(server.url, flush=True)
            _wait(stop)
        elif args.browser or not open_window(server.url, args.debug):
            webbrowser.open(server.url)
            print(f"{APP_NAME} : {server.url}\nCtrl+C pour quitter.", flush=True)
            _wait(stop)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        hub.stop()
        sampler.stop()
        sampler.join(timeout=5)
        history.close()
        server.stop()
    return 0
