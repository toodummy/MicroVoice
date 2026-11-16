"""Launch the localhost studio or synthesize a WAV from the command line."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
from threading import Timer
import webbrowser

ROOT = Path(__file__).resolve().parent


class StudioHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _reply(self, code, mime, body):
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code, message):
        self._reply(code, "application/json; charset=utf-8", json.dumps({"message": message}).encode())

    def do_POST(self):
        if self.path != "/api/synthesize":
            self._error(404, "Unknown endpoint.")
            return
        origin = self.headers.get("Origin")
        host = f"127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host") != host or (origin and origin != f"http://{host}"):
            self._error(403, "Open the studio using its displayed localhost address.")
            return
        if self.headers.get_content_type() != "application/json":
            self._error(415, "Expected a JSON request.")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= 512_000:
            self._error(413, "Request is missing or too large.")
            return
        try:
            from voice_model import generate
            payload = json.loads(self.rfile.read(length))
            audio = generate(payload)
        except (ValueError, UnicodeError) as error:
            self._error(400, str(error))
        except ImportError:
            self._error(500, "Install the dependencies listed in requirements.txt and restart the studio.")
        except Exception as error:
            print(f"Synthesis error: {error}", file=sys.stderr)
            self._error(500, "Synthesis failed. Check the terminal for details.")
        else:
            self._reply(200, "audio/wav", audio)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command")
    serve = commands.add_parser("serve", help="open the localhost browser studio")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--no-open", action="store_true")
    say = commands.add_parser("say", help="write a WAV on the CPU")
    source = say.add_mutually_exclusive_group(required=True)
    source.add_argument("--text")
    source.add_argument("--text-file", type=Path)
    languages = json.loads((ROOT / "site" / "model" / "voices.json").read_text(encoding="utf-8"))
    say.add_argument("--lang", choices=tuple(languages), default="en")
    say.add_argument("--voice", help="preset name (defaults to the first voice for the language)")
    say.add_argument("--voice-b", default="")
    say.add_argument("--blend", type=float, default=0)
    say.add_argument("--speed", type=float, default=1)
    say.add_argument("--output", "-o", type=Path, default=Path("speech.wav"))
    args = parser.parse_args()
    if args.command == "say":
        try:
            from voice_model import generate
            text = args.text if args.text is not None else args.text_file.read_text(encoding="utf-8")
            audio = generate({
                "text": text, "lang": args.lang, "voiceA": args.voice,
                "voiceB": args.voice_b, "blend": args.blend, "speed": args.speed,
            })
            args.output.write_bytes(audio)
        except ImportError:
            parser.exit(1, "Install the dependencies with python -m pip install -r requirements.txt.\n")
        except (ValueError, OSError) as error:
            parser.exit(1, f"{error}\n")
        print(f"Wrote {args.output.resolve()}")
        return

    port = getattr(args, "port", 8765)
    factory = partial(StudioHandler, directory=str(ROOT / "site"))
    try:
        with ThreadingHTTPServer(("127.0.0.1", port), factory) as server:
            url = f"http://127.0.0.1:{server.server_port}/"
            print(f"Local Voice Studio · {url}", flush=True)
            print("Press Ctrl+C to stop.", flush=True)
            if not getattr(args, "no_open", False):
                open_page = Timer(0.3, webbrowser.open, args=(url,))
                open_page.daemon = True
                open_page.start()
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    except OSError as error:
        parser.exit(1, f"Could not start studio: {error}. Try 'serve --port 8766'.\n")


if __name__ == "__main__":
    main()
