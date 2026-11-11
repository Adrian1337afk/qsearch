"""Tiny Marionette client for testing a running qsearch build.

Start the browser with `-marionette`, then:

    python qtest.py js "return Services.appinfo.name"     # chrome-context JS
    python qtest.py shot out.png                          # screenshot of the window
    python qtest.py url https://example.org               # load a page

Only the Python standard library is used.
"""
import base64
import json
import socket
import sys


class Marionette:
    def __init__(self, host="127.0.0.1", port=2828):
        self.sock = socket.create_connection((host, port), timeout=60)
        self.msg_id = 0
        self._read()  # server hello
        self.send("WebDriver:NewSession", {"capabilities": {}})

    def _read(self):
        length = b""
        while not length.endswith(b":"):
            chunk = self.sock.recv(1)
            if not chunk:
                raise ConnectionError("marionette closed the connection")
            length += chunk
        remaining = int(length[:-1])
        data = b""
        while len(data) < remaining:
            data += self.sock.recv(remaining - len(data))
        return json.loads(data)

    def send(self, name, params=None):
        self.msg_id += 1
        payload = json.dumps([0, self.msg_id, name, params or {}])
        self.sock.sendall(f"{len(payload)}:{payload}".encode())
        _, _, error, result = self._read()
        if error:
            raise RuntimeError(f"{name}: {error.get('error')}: {error.get('message')}")
        return result.get("value", result) if isinstance(result, dict) else result

    def chrome(self):
        self.send("Marionette:SetContext", {"value": "chrome"})

    def content(self):
        self.send("Marionette:SetContext", {"value": "content"})

    def js(self, script, timeout_ms=30000):
        self.send("WebDriver:SetTimeouts", {"script": timeout_ms})
        return self.send("WebDriver:ExecuteAsyncScript", {
            "script": "let done = arguments[arguments.length - 1];"
                      "(async () => {" + script + chr(10) +
                      "})().then(done, e => done('ERROR: ' + e + ' | ' + (e && e.stack)));",
            "args": [],
        })

    def screenshot(self, path):
        data = self.send("WebDriver:TakeScreenshot", {"full": True})
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))

    def close(self):
        # Leave the browser running; just drop the session.
        try:
            self.send("WebDriver:DeleteSession")
        except Exception:
            pass
        self.sock.close()


def main():
    cmd, arg = sys.argv[1], sys.argv[2]
    m = Marionette()
    try:
        if cmd == "js":
            m.chrome()
            print(json.dumps(m.js(arg), indent=1, default=str))
        elif cmd == "jsfile":
            m.chrome()
            print(json.dumps(m.js(open(arg, encoding="utf-8").read()), indent=1, default=str))
        elif cmd == "shot":
            m.chrome()
            m.screenshot(arg)
            print("saved", arg)
        elif cmd == "url":
            m.content()
            m.send("WebDriver:Navigate", {"url": arg})
            print("loaded", arg)
    finally:
        m.close()


if __name__ == "__main__":
    main()
