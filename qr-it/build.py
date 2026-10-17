#!/usr/bin/env python3
"""Build QR-IT into public/ as a single self-contained index.html.

Usage:  python3 build.py

Edit src/app.html (markup + styles) and src/app.js (logic), then run this.
The page gets a Content-Security-Policy with a hash for every inline script,
so the browser itself blocks any network request the page didn't come with.
"""
import base64, hashlib, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent
SRC, VENDOR, OUT = ROOT / "src", ROOT / "vendor", ROOT / "public"

VERSION = "1.0.0"
DESCRIPTION = "QR-IT: free static QR code generator. Codes never expire. No account, no tracking, nothing uploaded."

html = (SRC / "app.html").read_text(encoding="utf-8")
html = (html.replace("/*__QRLIB__*/", (VENDOR / "qrcode.min.js").read_text(encoding="utf-8"))
            .replace("/*__JSQR__*/", (VENDOR / "jsqr.min.js").read_text(encoding="utf-8"))
            .replace("/*__APP__*/", (SRC / "app.js").read_text(encoding="utf-8")))
html = html.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")

hashes = []
for m in re.finditer(r"<script>(.*?)</script>", html, re.S):
    digest = hashlib.sha256(m.group(1).encode("utf-8")).digest()
    hashes.append("'sha256-" + base64.b64encode(digest).decode() + "'")

csp = "; ".join([
    "default-src 'none'",
    "script-src " + " ".join(hashes),
    "style-src 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
])

split = html.index("</style>") + len("</style>")
head, body = html[:split], html[split:]
head = head.replace("* { box-sizing: border-box; }",
                    "* { box-sizing: border-box; }\nhtml { color-scheme: light; } body { margin: 0; }", 1)

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="{csp}">
<meta name="description" content="{DESCRIPTION}">
<meta name="generator" content="QR-IT {VERSION}">
<meta name="theme-color" content="#2443c9">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
{head}
</head>
<body>{body}
</body>
</html>
"""
OUT.mkdir(exist_ok=True)
(OUT / "index.html").write_text(page, encoding="utf-8")

# Service worker cache name changes whenever the page changes, so updates roll out.
page_hash = hashlib.sha256(page.encode("utf-8")).hexdigest()[:10]
sw = (SRC / "sw.js").read_text(encoding="utf-8").replace("__CACHE__", f"qr-it-{VERSION}-{page_hash}")
(OUT / "sw.js").write_text(sw, encoding="utf-8")

print(f"Built public/index.html ({len(page.encode()):,} bytes), cache qr-it-{VERSION}-{page_hash}")
