"""
Railway / single-port entrypoint for MiroFish + Swarm Town.

Serves on one port ($PORT):
  /api/*      MiroFish backend (unchanged blueprints)
  /health     health check (no auth, used by Railway)
  /town/*     Swarm Town game (static files from ../game)
  /*          MiroFish Vue frontend (static build from ../frontend/dist, SPA fallback)

Protects everything except /health with HTTP Basic Auth when
BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are set. MiroFish itself has no
authentication, so never deploy it publicly without these variables.
"""

import base64
import hmac
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Response, request, send_from_directory  # noqa: E402

from app import create_app  # noqa: E402
from app.config import Config  # noqa: E402

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIST = os.path.abspath(
    os.environ.get("FRONTEND_DIST", os.path.join(BASE_DIR, "..", "frontend", "dist"))
)
GAME_DIR = os.path.abspath(os.environ.get("GAME_DIR", os.path.join(BASE_DIR, "..", "game")))

AUTH_USER = os.environ.get("BASIC_AUTH_USER", "")
AUTH_PASSWORD = os.environ.get("BASIC_AUTH_PASSWORD", "")
AUTH_EXEMPT = ("/health",)


def _auth_ok() -> bool:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Basic "):
        return False
    try:
        user, _, password = base64.b64decode(header[6:]).decode("utf-8").partition(":")
    except Exception:
        return False
    return hmac.compare_digest(user, AUTH_USER) and hmac.compare_digest(password, AUTH_PASSWORD)


def build_app():
    app = create_app()

    @app.before_request
    def require_basic_auth():
        if not (AUTH_USER and AUTH_PASSWORD):
            return None
        if request.path in AUTH_EXEMPT or request.method == "OPTIONS":
            return None
        if _auth_ok():
            return None
        return Response(
            "Authentication required",
            401,
            {"WWW-Authenticate": 'Basic realm="MiroFish", charset="UTF-8"'},
        )

    @app.route("/town")
    def town_redirect():
        return Response(status=301, headers={"Location": "/town/"})

    @app.route("/town/", defaults={"path": "index.html"})
    @app.route("/town/<path:path>")
    def town(path):
        return send_from_directory(GAME_DIR, path)

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def frontend(path):
        if path.startswith("api/"):
            return {"success": False, "error": "Not found"}, 404
        full = os.path.join(FRONTEND_DIST, path)
        if path and os.path.isfile(full):
            return send_from_directory(FRONTEND_DIST, path)
        if os.path.isfile(os.path.join(FRONTEND_DIST, "index.html")):
            return send_from_directory(FRONTEND_DIST, "index.html")
        return "MiroFish frontend is not built. Open /town/ for Swarm Town.", 200

    return app


def main():
    errors = Config.validate()
    if errors:
        print("Configuration errors:")
        for err in errors:
            print(f"  - {err}")
        sys.exit(1)
    if not (AUTH_USER and AUTH_PASSWORD):
        if os.environ.get("ALLOW_PUBLIC") != "1":
            print("Refusing to start: set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD "
                  "(or ALLOW_PUBLIC=1 to run without authentication).")
            sys.exit(1)
        print("WARNING: ALLOW_PUBLIC=1 - the site is PUBLIC, anyone can spend your API credits.")

    app = build_app()
    port = int(os.environ.get("PORT", os.environ.get("FLASK_PORT", 5001)))
    # Single process on purpose: MiroFish keeps simulation runner state in memory.
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
