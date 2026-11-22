# Pokédex

Pokédex desktop app built with PyQt6, QtWebEngine and PokeAPI.
Python hosts the window and a persistent SQLite cache; the UI and all async API calls run in JavaScript, connected through QWebChannel.

## Run

```
pip install -r requirements.txt
python main.py
```

## Layout

- `main.py` – window, QWebChannel bridge, SQLite cache
- `web/` – `index.html`, `style.css`, `app.js`

Cache is stored in `~/.pokedex_qt/cache.db`.
