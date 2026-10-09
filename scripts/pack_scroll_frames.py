"""Pack EVERY frame from inicio-scroll-unificado for responsive, bounded loading.

Run: python3 scripts/pack_scroll_frames.py (requires Pillow).
Source WebPs, frame counts, order, and endpoints stay unchanged.
"""
import hashlib
import json
import struct
from concurrent.futures import ProcessPoolExecutor
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CLIPS = [("clip-01", 480), ("clip-02", 192), ("clip-03", 192)]
GROUP_SIZE = 64
MAGIC = b"JSEQ001\n"


def pack_group(task):
    variant, clip, start, stop, global_start = task
    encoded = []
    sources = hashlib.sha256()
    for index in range(start, stop):
        path = ROOT / "public/secuencias/joker" / clip / f"frame-{index + 1:03}.webp"
        sources.update(path.read_bytes())
        with Image.open(path) as original:
            image = original.convert("RGB")
            if variant == "mobile":
                width = round(image.height * .75)
                left = round((image.width - width) * .58)
                image = image.crop((left, 0, left + width, image.height))
            else:
                image = image.resize((960, 540), Image.Resampling.LANCZOS)
            buffer = BytesIO()
            image.save(buffer, "WEBP", quality=85, method=4)
            encoded.append(buffer.getvalue())
    payload = MAGIC + struct.pack("<I", len(encoded))
    payload += struct.pack(f"<{len(encoded)}I", *(len(frame) for frame in encoded))
    payload += b"".join(encoded)
    digest = hashlib.sha256(payload).hexdigest()[:16]
    directory = ROOT / "public/secuencias/joker/packed" / variant
    directory.mkdir(parents=True, exist_ok=True)
    name = f"{clip}-{start + 1:03}-{digest}.bin"
    (directory / name).write_bytes(payload)
    return variant, {
        "url": f"/secuencias/joker/packed/{variant}/{name}",
        "start": global_start + start,
        "count": len(encoded),
        "bytes": len(payload),
        "sourceSha256": sources.hexdigest(),
    }


if __name__ == "__main__":
    tasks = []
    for variant in ["desktop", "mobile"]:
        global_start = 0
        for clip, count in CLIPS:
            sources = sorted((ROOT / "public/secuencias/joker" / clip).glob("frame-*.webp"))
            if len(sources) != count:
                raise ValueError(f"{clip}: expected {count} frames, found {len(sources)}")
            tasks.extend((variant, clip, start, min(start + GROUP_SIZE, count), global_start)
                         for start in range(0, count, GROUP_SIZE))
            global_start += count
    manifest = {"sourceBranch": "inicio-scroll-unificado",
                "sourceCommit": "54387c7b571703000b74fd7d3051d09601e6f79a",
                "desktop": [], "mobile": []}
    with ProcessPoolExecutor(max_workers=3) as pool:
        for variant, descriptor in pool.map(pack_group, tasks):
            manifest[variant].append(descriptor)
            print(f"Packed {variant} frames {descriptor['start'] + 1}–"
                  f"{descriptor['start'] + descriptor['count']}", flush=True)
    destination = ROOT / "src/config/sequenceBundles.json"
    destination.write_text(json.dumps(manifest, indent=2) + "\n")
    for variant in ["desktop", "mobile"]:
        print(variant, "bytes:", sum(pack["bytes"] for pack in manifest[variant]))
