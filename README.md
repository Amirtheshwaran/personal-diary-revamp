# Personal Diary (Revamp)

Web-based revamp of my old first-year university C console project, [Personal-Diary-Sys](https://github.com/Amirtheshwaran/Personal-Diary-Sys).

Kept the same core functionality (dated diary entries with time, place, and duration, plus password protection), but redesigned it as a local offline web app with a dark UI, keyboard shortcuts, and SQLite for storage.

## Running the App

Requires Python 3. No third-party packages or `pip install` required.

```bash
python server.py
```

Then open **http://localhost:8420** in your browser.

The first time you run it, you will be prompted to set a password. After that, the diary locks whenever the server is restarted.

## Project Structure

- `server.py`: Standard library HTTP server and API routing (SQLite CRUD, PBKDF2-SHA256 password hashing).
- `static/`: Frontend interface (HTML, CSS, vanilla JS, and bundled fonts). No CDN calls or npm build step.
- `data/diary.db`: SQLite database generated on launch. To back up your diary, simply copy this file.
