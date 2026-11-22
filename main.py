"""Pokédex: PyQt6 + QtWebEngine + PokeAPI."""
import sqlite3
import sys
import threading
from pathlib import Path

from PyQt6.QtCore import QFile, QIODevice, QObject, QUrl, pyqtSlot
from PyQt6.QtGui import QColor, QGuiApplication
from PyQt6.QtWebChannel import QWebChannel
from PyQt6.QtWebEngineCore import QWebEnginePage, QWebEngineScript, QWebEngineSettings
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWidgets import QApplication, QMainWindow

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
DATA_DIR = Path.home() / ".pokedex_qt"


class Bridge(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(DATA_DIR / "cache.db", check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
            self._db.commit()

    @pyqtSlot(str, result=str)
    def cacheGet(self, key: str) -> str:
        with self._lock:
            row = self._db.execute("SELECT v FROM cache WHERE k=?", (key,)).fetchone()
        return row[0] if row else ""

    @pyqtSlot(str, str)
    def cacheSet(self, key: str, value: str) -> None:
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO cache (k, v) VALUES (?, ?)", (key, value))
            self._db.commit()

    @pyqtSlot()
    def cacheClear(self) -> None:
        with self._lock:
            self._db.execute("DELETE FROM cache")
            self._db.commit()

    def shutdown(self) -> None:
        with self._lock:
            self._db.execute("DELETE FROM cache")
            self._db.commit()
            self._db.execute("VACUUM")
            self._db.close()

    @pyqtSlot(str)
    def copyText(self, text: str) -> None:
        QGuiApplication.clipboard().setText(text)


class Page(QWebEnginePage):
    def javaScriptConsoleMessage(self, level, message, line, source):
        print(f"[JS] {message}  ({Path(source).name}:{line})")


class Window(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Pokédex")
        self.resize(1280, 860)

        self.view = QWebEngineView(self)
        self.page_ = Page(self.view)
        self.page_.setBackgroundColor(QColor("#f2f2f2"))
        self.view.setPage(self.page_)

        s = self.page_.settings()
        s.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        s.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)

        self.bridge = Bridge(self)
        self.channel = QWebChannel(self.page_)
        self.channel.registerObject("bridge", self.bridge)
        self.page_.setWebChannel(self.channel)
        self._inject_webchannel_js()

        self.setCentralWidget(self.view)
        self._load_ui()

    def closeEvent(self, event):
        self.bridge.shutdown()
        super().closeEvent(event)

    def _load_ui(self):
        base = WEB
        html = (base / "index.html").read_text(encoding="utf-8")
        css = (base / "style.css").read_text(encoding="utf-8")
        js = (base / "app.js").read_text(encoding="utf-8")
        html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}\n</style>")
        html = html.replace('<script src="app.js"></script>', f"<script>\n{js}\n</script>")
        self.view.setHtml(html, QUrl.fromLocalFile(str(base) + "/"))

    def _inject_webchannel_js(self):
        f = QFile(":/qtwebchannel/qwebchannel.js")
        if not f.open(QIODevice.OpenModeFlag.ReadOnly):
            return
        src = bytes(f.readAll()).decode("utf-8")
        f.close()
        script = QWebEngineScript()
        script.setName("qwebchannel")
        script.setSourceCode(src)
        script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
        script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
        script.setRunsOnSubFrames(False)
        self.page_.scripts().insert(script)


def main():
    app = QApplication(sys.argv)
    win = Window()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
