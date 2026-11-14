"""Render scene.html into an animated GIF with headless Chrome. No extra packages beyond websockets.

    .venv/bin/python docs/flow-animation/render.py docs/a2ui-flow.gif          # the GIF
    .venv/bin/python docs/flow-animation/render.py still.png --still 12.8      # one frame

Frames are captured every 0.1 s; identical neighbours are merged into one longer frame, and each
frame after the first stores only the rectangle that changed. The GIF encoder is written out below.
"""
import asyncio, base64, json, os, struct, subprocess, sys, tempfile, time, urllib.request
from collections import Counter
from pathlib import Path

import websockets

HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H, STEP, END, LAST_HOLD = 1080, 1350, 0.1, 19.0, 0.6


async def capture(times):
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen([CHROME, "--headless=new", "--remote-debugging-port=9334", f"--user-data-dir={prof}",
                             "--hide-scrollbars", "--no-first-run", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                tg = json.load(urllib.request.urlopen("http://127.0.0.1:9334/json")); break
            except Exception:
                time.sleep(0.2)
        url = next(t for t in tg if t["type"] == "page")["webSocketDebuggerUrl"]
        async with websockets.connect(url, max_size=100_000_000) as ws:
            n = 0
            async def cmd(method, **params):
                nonlocal n; n += 1; me = n
                await ws.send(json.dumps({"id": me, "method": method, "params": params}))
                while True:
                    m = json.loads(await ws.recv())
                    if m.get("id") == me:
                        if "error" in m: raise RuntimeError(m["error"])
                        return m.get("result", {})
            await cmd("Emulation.setDeviceMetricsOverride", width=W, height=H, deviceScaleFactor=1, mobile=False)
            await cmd("Page.enable")
            await cmd("Page.navigate", url=(HERE / "scene.html").as_uri())
            await asyncio.sleep(1.0)
            shots = []
            for t in times:
                await cmd("Runtime.evaluate", expression=f"window.at({t})")
                await asyncio.sleep(0.03)
                shots.append(base64.b64decode((await cmd("Page.captureScreenshot", format="png"))["data"]))
            return shots
    finally:
        proc.terminate()


def png_to_rgb(png: bytes, tmp: Path) -> bytes:
    """Decode with macOS sips (PNG → BMP), then read the BMP rows top-down as packed RGB."""
    (tmp / "f.png").write_bytes(png)
    subprocess.run(["sips", "-s", "format", "bmp", str(tmp / "f.png"), "--out", str(tmp / "f.bmp")],
                   check=True, stdout=subprocess.DEVNULL)
    b = (tmp / "f.bmp").read_bytes()
    off, w, h, bpp = struct.unpack_from("<I", b, 10)[0], *struct.unpack_from("<ii", b, 18), struct.unpack_from("<H", b, 28)[0]
    step, bp = ((w * bpp // 8 + 3) // 4) * 4, bpp // 8
    rows = []
    for y in range(abs(h)):
        r = b[off + (y if h < 0 else abs(h) - 1 - y) * step:][: w * bp]
        rows.append(bytes(c for i in range(0, len(r), bp) for c in (r[i + 2], r[i + 1], r[i])))
    return b"".join(rows)


def lzw(idx: bytes, min_size: int = 8) -> bytes:
    clear, eoi = 1 << min_size, (1 << min_size) + 1
    out, buf, cnt = bytearray(), 0, 0
    def emit(code, size):
        nonlocal buf, cnt
        buf |= code << cnt; cnt += size
        while cnt >= 8:
            out.append(buf & 255); buf >>= 8; cnt -= 8
    def reset():
        return {}, min_size + 1, eoi + 1
    table, size, nxt = reset()
    emit(clear, size)
    w = idx[0]
    for k in idx[1:]:
        key = (w << 8) | k
        hit = table.get(key)
        if hit is not None:
            w = hit; continue
        emit(w, size)
        if nxt < 4095:
            table[key] = nxt; nxt += 1
            if nxt > (1 << size): size += 1
        else:
            emit(clear, size); table, size, nxt = reset()
        w = k
    emit(w, size); emit(eoi, size)
    if cnt: out.append(buf & 255)
    return bytes(out)


def blocks(data: bytes) -> bytes:
    return b"".join(bytes([len(data[i:i + 255])]) + data[i:i + 255] for i in range(0, len(data), 255)) + b"\x00"


def encode_gif(frames, delays_cs, path):
    """frames: packed RGB, all W×H. Palette: the 256 most common colours, the rest mapped to the nearest."""
    count = Counter()
    for f in frames:
        count.update(f[i:i + 3] for i in range(0, len(f), 3 * 7))
    pal = [c for c, _ in count.most_common(256)]
    pal += [b"\0\0\0"] * (256 - len(pal))
    lookup = {c: i for i, c in enumerate(pal)}
    def nearest(c):
        r, g, b = c
        return min(range(256), key=lambda i: (pal[i][0] - r) ** 2 + (pal[i][1] - g) ** 2 + (pal[i][2] - b) ** 2)
    def indexed(f):
        out = bytearray(len(f) // 3)
        for j in range(len(out)):
            c = f[3 * j:3 * j + 3]
            i = lookup.get(c)
            if i is None:
                i = lookup[c] = nearest(c)
            out[j] = i
        return bytes(out)

    out = bytearray(b"GIF89a" + struct.pack("<HHBBB", W, H, 0xF7, 0, 0) + b"".join(pal))
    out += b"\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00"  # loop forever
    prev = None
    for f, d in zip(frames, delays_cs):
        cur = indexed(f)
        if prev is None:
            x0, y0, x1, y1 = 0, 0, W, H
        else:
            ys = [y for y in range(H) if cur[y * W:(y + 1) * W] != prev[y * W:(y + 1) * W]]
            if not ys:
                ys = [0]
            y0, y1 = ys[0], ys[-1] + 1
            xs = [x for x in range(W) if any(cur[y * W + x] != prev[y * W + x] for y in range(y0, y1))] or [0]
            x0, x1 = xs[0], xs[-1] + 1
        sub = b"".join(cur[y * W + x0:y * W + x1] for y in range(y0, y1))
        out += b"\x21\xF9\x04\x04" + struct.pack("<H", d) + b"\x00\x00"   # disposal: leave in place
        out += b"\x2C" + struct.pack("<HHHHB", x0, y0, x1 - x0, y1 - y0, 0)
        out += b"\x08" + blocks(lzw(sub))
        prev = cur
    out += b"\x3B"
    Path(path).write_bytes(out)


def main():
    target = Path(sys.argv[1])
    if "--still" in sys.argv:
        t = float(sys.argv[sys.argv.index("--still") + 1])
        target.write_bytes(asyncio.run(capture([t]))[0]); return
    times = [round(i * STEP, 2) for i in range(int(END / STEP))]
    shots = asyncio.run(capture(times))
    merged = []  # [png, seconds]
    for s in shots:
        if merged and merged[-1][0] == s:
            merged[-1][1] += STEP
        else:
            merged.append([s, STEP])
    merged[-1][1] += LAST_HOLD
    print(f"{len(shots)} captures → {len(merged)} distinct frames")
    tmp = Path(tempfile.mkdtemp())
    frames = [png_to_rgb(png, tmp) for png, _ in merged]
    encode_gif(frames, [max(2, round(sec * 100)) for _, sec in merged], target)
    print(f"wrote {target} ({target.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
