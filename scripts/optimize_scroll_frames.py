"""Build the responsive scroll sequence from the original PNGs (requires Pillow).

Run from any directory: python3 scripts/optimize_scroll_frames.py
Originals remain untouched. Keep both endpoints and the same clip duration.
"""

from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "public/secuencias/joker"
FRAME_COUNT = 160


def convert(task):
    clip, index = task
    source_index = round(index * 479 / (FRAME_COUNT - 1)) + 1
    with Image.open(ROOT / clip / f"frame-{source_index:03}.png") as source:
        image = source.convert("RGB")
        for variant, width in (("desktop", 960), ("mobile", 540)):
            destination = ROOT / "optimized" / variant / clip
            destination.mkdir(parents=True, exist_ok=True)
            if variant == "mobile":
                # Match the canvas' 58% horizontal position. Preserve the original
                # 720px height instead of enlarging a soft, downscaled panorama.
                left = round((image.width - width) * .58)
                resized = image.crop((left, 0, left + width, image.height))
            else:
                resized = image.resize((width, width * 9 // 16), Image.Resampling.LANCZOS)
            resized.save(destination / f"frame-{index + 1:03}.webp", "WEBP", quality=82, method=4)


if __name__ == "__main__":
    tasks = [(f"clip-{clip:02}", index) for clip in range(1, 4) for index in range(FRAME_COUNT)]
    with ProcessPoolExecutor(max_workers=3) as pool:
        for count, _ in enumerate(pool.map(convert, tasks), 1):
            if count % 80 == 0:
                print(f"Optimized {count}/{len(tasks)} source frames", flush=True)
