from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import os

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[1]
CLIP_DIRS = [
    ROOT / "public" / "secuencias" / "joker" / "clip-02",
    ROOT / "public" / "secuencias" / "joker" / "clip-03",
]


def convert_frame(source: Path) -> tuple[Path, Path]:
    target = source.with_suffix(".webp")
    if target.exists() and target.stat().st_size > 0:
        try:
            verify_frame(source, target)
            return source, target
        except (OSError, RuntimeError):
            pass
    with Image.open(source) as image:
        image.save(
            target,
            "WEBP",
            lossless=True,
            quality=100,
            method=4,
            exact=True,
        )
    return source, target


def verify_frame(source: Path, target: Path) -> None:
    with Image.open(source) as original, Image.open(target) as optimized:
        original_rgba = original.convert("RGBA")
        optimized_rgba = optimized.convert("RGBA")
        if original_rgba.size != optimized_rgba.size:
            raise RuntimeError(f"Dimensiones distintas: {source.name}")
        if ImageChops.difference(original_rgba, optimized_rgba).getbbox() is not None:
            raise RuntimeError(f"Los píxeles cambiaron: {source.name}")


def main() -> None:
    sources = [frame for folder in CLIP_DIRS for frame in sorted(folder.glob("frame-*.png"))]
    if not sources:
        raise RuntimeError("No se encontraron fotogramas PNG para optimizar.")

    before = sum(frame.stat().st_size for frame in sources)
    completed = 0
    workers = min(8, os.cpu_count() or 1)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(convert_frame, source) for source in sources]
        for future in as_completed(futures):
            future.result()
            completed += 1
            if completed % 24 == 0 or completed == len(sources):
                print(f"Optimizadas {completed} de {len(sources)}", flush=True)

    samples = []
    for folder in CLIP_DIRS:
        pngs = sorted(folder.glob("frame-*.png"))
        samples.extend([pngs[0], pngs[len(pngs) // 2], pngs[-1]])
    for source in samples:
        verify_frame(source, source.with_suffix(".webp"))

    after = sum(frame.with_suffix(".webp").stat().st_size for frame in sources)
    saved = before - after
    print(f"Verificación exacta superada en {len(samples)} fotogramas.")
    print(f"Antes: {before:,} bytes")
    print(f"Después: {after:,} bytes")
    print(f"Ahorro: {saved:,} bytes ({saved / before:.1%})")


if __name__ == "__main__":
    main()
