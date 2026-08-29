import gc
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/assets/mascota-joker/source/urban-pose-sheet.png"
OUTPUT = ROOT / "src/assets/mascota-joker/secuencia"

WIDTH = 1440
HEIGHT = 810
FRAME_COUNT = 360

NAVY = (27, 26, 74)
DARK = (12, 13, 34)
TURQUOISE = (78, 216, 196)
GOLD = (242, 183, 5)
CORAL = (241, 88, 70)
WHITE = (255, 255, 255)


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def smoothstep(value):
    value = clamp(value)
    return value * value * (3 - 2 * value)


def mix(a, b, amount):
    amount = smoothstep(amount)
    return tuple(round(x + (y - x) * amount) for x, y in zip(a, b))


def stage_color(progress):
    if progress < 0.34:
        return mix(GOLD, CORAL, progress / 0.34)
    if progress < 0.64:
        return mix(CORAL, TURQUOISE, (progress - 0.34) / 0.30)
    if progress < 0.84:
        return mix(TURQUOISE, NAVY, (progress - 0.64) / 0.20)
    return mix(NAVY, DARK, (progress - 0.84) / 0.16)


def isolate_sprite(sheet, x1, x2, seed):
    crop = sheet.crop((x1, 0, x2, sheet.height))
    binary = crop.getchannel("A").point(lambda value: 255 if value > 5 else 0)
    ImageDraw.floodfill(binary, seed, 128, thresh=0)
    component = binary.point(lambda value: 255 if value == 128 else 0)
    alpha = ImageChops.multiply(crop.getchannel("A"), component)
    bbox = alpha.getbbox()
    sprite = crop.crop(bbox)
    sprite.putalpha(alpha.crop(bbox))
    return sprite


def load_sprites():
    sheet = Image.open(SOURCE).convert("RGBA")
    specs = [
        (0, 365, (180, 450)),
        (315, 700, (185, 600)),
        (650, 980, (170, 450)),
        (940, 1240, (140, 450)),
        (1200, 1520, (160, 600)),
        (1490, 1774, (150, 550)),
    ]
    return [isolate_sprite(sheet, *spec) for spec in specs]


def font(size):
    candidates = [
        Path(r"C:\Windows\Fonts\arialbd.ttf"),
        Path(r"C:\Windows\Fonts\segoeuib.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


TITLE_FONT = font(132)
PRODUCT_FONT = font(118)
SMALL_FONT = font(24)


def draw_background(canvas, progress, frame_index):
    draw = ImageDraw.Draw(canvas, "RGBA")
    color = stage_color(progress)
    draw.rectangle((0, 0, WIDTH, HEIGHT), fill=(*color, 255))

    drift = frame_index * 2.1
    draw.ellipse(
        (-360 + drift % 460, -390, 420 + drift % 460, 390),
        fill=(*TURQUOISE, 72),
    )
    draw.polygon(
        [
            (WIDTH - 260, -120),
            (WIDTH + 240, 40),
            (WIDTH + 50, 520),
            (WIDTH - 370, 310),
        ],
        fill=(*CORAL, 100 if progress < 0.72 else 45),
    )
    draw.ellipse(
        (WIDTH - 180 - drift % 220, HEIGHT - 150, WIDTH + 240, HEIGHT + 260),
        fill=(*GOLD, 105),
    )

    for index in range(7):
        x = (120 + index * 230 + frame_index * (index + 1) * 0.38) % (WIDTH + 200) - 100
        y = 70 + ((index * 137) % 610)
        radius = 7 + (index % 3) * 5
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*DARK, 95))


def painting_state(progress):
    """Devuelve la línea, avance y punto exacto de la boquilla durante el grafiti."""
    amount = clamp((progress - 0.01) / 0.48)
    timeline = min(amount * 3, 2.9999)
    line_index = int(timeline)
    local = timeline - line_index
    drawing = local < 0.84 or line_index == 2
    stroke_progress = smoothstep(local / 0.84) if drawing else 1.0

    positions = [(400, 105), (400, 260), (400, 415)]
    labels = ["HACEMOS", "VISIBLE", "TU MARCA"]
    box = ImageDraw.Draw(Image.new("L", (1, 1))).textbbox(
        positions[line_index], labels[line_index], font=TITLE_FONT
    )
    start_x = positions[line_index][0]
    end_x = min(box[2] + 18, WIDTH - 45)
    nozzle_x = start_x + (end_x - start_x) * stroke_progress
    nozzle_y = positions[line_index][1] + 82

    if not drawing and line_index < 2:
        reposition = smoothstep((local - 0.84) / 0.16)
        next_y = positions[line_index + 1][1] + 82
        nozzle_x = end_x + (positions[line_index + 1][0] - end_x) * reposition
        nozzle_y += (next_y - nozzle_y) * reposition

    return {
        "amount": amount,
        "line": line_index,
        "local": local,
        "drawing": drawing,
        "stroke": stroke_progress,
        "x": nozzle_x,
        "y": nozzle_y,
    }


def draw_title(canvas, progress, splatters):
    layer = Image.new("RGBA", canvas.size)
    draw = ImageDraw.Draw(layer, "RGBA")
    lines = ["HACEMOS", "VISIBLE", "TU MARCA"]
    positions = [(400, 105), (400, 260), (400, 415)]

    for text, position in zip(lines, positions):
        draw.text(
            position,
            text,
            font=TITLE_FONT,
            fill=(0, 0, 0, 0),
            stroke_width=3,
            stroke_fill=(*NAVY, 105),
        )

    text_mask = Image.new("L", canvas.size)
    mask_draw = ImageDraw.Draw(text_mask)
    for text, position in zip(lines, positions):
        mask_draw.text(position, text, font=TITLE_FONT, fill=255)

    reveal = Image.new("L", canvas.size)
    reveal_draw = ImageDraw.Draw(reveal)
    state = painting_state(progress)
    for index, (text, position) in enumerate(zip(lines, positions)):
        text_box = mask_draw.textbbox(position, text, font=TITLE_FONT)
        if index < state["line"]:
            reveal_draw.rectangle(text_box, fill=255)
        elif index == state["line"]:
            reveal_x = round(text_box[0] + (text_box[2] - text_box[0]) * state["stroke"])
            reveal_draw.rectangle((text_box[0], text_box[1], reveal_x, text_box[3]), fill=255)

    ragged = Image.new("L", canvas.size)
    ragged_draw = ImageDraw.Draw(ragged)
    for x, y, radius, threshold in splatters:
        if threshold <= state["amount"]:
            ragged_draw.ellipse((x + 330 - radius, y - radius, x + 330 + radius, y + radius), fill=255)

    visible_mask = ImageChops.multiply(text_mask, ImageChops.lighter(reveal, ragged))
    fill_layer = Image.new("RGBA", canvas.size, (*DARK, 255))
    fill_layer.putalpha(visible_mask)
    layer.alpha_composite(fill_layer)

    if progress < 0.51 and state["drawing"]:
        spray = ImageDraw.Draw(layer, "RGBA")
        rng = random.Random(round(progress * FRAME_COUNT) + 20260827)
        for _ in range(52):
            distance = rng.randint(-22, 86)
            x = state["x"] + distance
            y = state["y"] + rng.randint(-24, 24) + distance * rng.uniform(-0.12, 0.12)
            radius = rng.randint(2, 9)
            spray.ellipse(
                (x - radius, y - radius, x + radius, y + radius),
                fill=(*TURQUOISE, rng.randint(105, 230)),
            )

    fade = 1 - smoothstep((progress - 0.51) / 0.07)
    layer.putalpha(layer.getchannel("A").point(lambda value: round(value * fade)))
    canvas.alpha_composite(layer)


def text_layer(text, color, progress, start, end, y=150, size_font=PRODUCT_FONT):
    fade_in = smoothstep((progress - start) / 0.035)
    fade_out = 1 - smoothstep((progress - (end - 0.035)) / 0.035)
    alpha = clamp(min(fade_in, fade_out))
    layer = Image.new("RGBA", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(layer)
    draw.multiline_text((70, y), text, font=size_font, fill=(*color, round(255 * alpha)), spacing=-8)
    return layer


def draw_neon_sign(canvas, progress):
    amount = smoothstep((progress - 0.54) / 0.08) * (1 - smoothstep((progress - 0.66) / 0.05))
    if amount <= 0:
        return
    layer = Image.new("RGBA", canvas.size)
    x = round(860 + (1 - amount) * 320)
    y = 245
    glow_draw = ImageDraw.Draw(layer, "RGBA")
    for expansion, alpha, line_width in ((34, 24, 24), (22, 38, 18), (12, 62, 12)):
        glow_draw.rounded_rectangle(
            (x - expansion, y - expansion, x + 360 + expansion, y + 220 + expansion),
            radius=32 + expansion,
            outline=(*TURQUOISE, alpha),
            width=line_width,
        )
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle((x, y, x + 360, y + 220), radius=32, fill=(*NAVY, 240), outline=(*GOLD, 255), width=7)
    draw.line((x + 45, y + 160, x + 135, y + 58, x + 220, y + 164, x + 315, y + 58), fill=(*TURQUOISE, 255), width=18, joint="curve")
    layer.putalpha(layer.getchannel("A").point(lambda value: round(value * amount)))
    canvas.alpha_composite(layer)


def draw_print_products(canvas, progress):
    amount = smoothstep((progress - 0.66) / 0.07) * (1 - smoothstep((progress - 0.83) / 0.05))
    if amount <= 0:
        return
    layer = Image.new("RGBA", canvas.size)
    draw = ImageDraw.Draw(layer, "RGBA")
    offset = round((1 - amount) * 260)

    draw.rounded_rectangle((900 + offset, 130, 1210 + offset, 315), radius=18, fill=(*NAVY, 245))
    draw.arc((930 + offset, 155, 1170 + offset, 290), 190, 355, fill=(*GOLD, 255), width=15)
    draw.line((945 + offset, 260, 1160 + offset, 180), fill=(*TURQUOISE, 255), width=13)

    draw.ellipse((1020 + offset, 385, 1260 + offset, 605), fill=(*DARK, 245), outline=(*GOLD, 255), width=10)
    draw.ellipse((1080 + offset, 435, 1200 + offset, 555), fill=(*TURQUOISE, 255))
    draw.rectangle((1120 + offset, 495, 1390 + offset, 635), fill=(*TURQUOISE, 255))

    for index, angle in enumerate((-10, 5, 17)):
        card = Image.new("RGBA", (250, 145), (*WHITE, 255))
        card_draw = ImageDraw.Draw(card)
        card_draw.rectangle((0, 0, 250, 35), fill=(*NAVY, 255))
        card_draw.ellipse((25, 55, 75, 105), fill=(*GOLD, 255))
        card_draw.line((95, 62, 220, 62), fill=(*NAVY, 255), width=9)
        card_draw.line((95, 90, 190, 90), fill=(*TURQUOISE, 255), width=9)
        card = card.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
        layer.alpha_composite(card, (790 + offset + index * 105, 565 - index * 24))

    layer.putalpha(layer.getchannel("A").point(lambda value: round(value * amount)))
    canvas.alpha_composite(layer)


def paste_sprite(canvas, sprite, x, bottom, target_height, opacity=1.0, angle=0):
    ratio = target_height / sprite.height
    resized = sprite.resize((round(sprite.width * ratio), target_height), Image.Resampling.LANCZOS)
    if angle:
        resized = resized.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    if opacity < 1:
        resized.putalpha(resized.getchannel("A").point(lambda value: round(value * opacity)))
    canvas.alpha_composite(resized, (round(x - resized.width / 2), round(bottom - resized.height)))


def draw_mascot(canvas, sprites, progress, frame_index):
    bob = math.sin(frame_index * 0.17)
    sway = math.sin(frame_index * 0.085)

    if progress < 0.51:
        state = painting_state(progress)
        line_index = state["line"]
        target_height = [440, 410, 380][line_index]
        center_x = state["x"] - target_height * 0.13
        bottom = state["y"] + target_height * 0.80 + bob * 4
        angle = sway * 1.25
        paste_sprite(canvas, sprites[4], center_x, bottom, target_height, 1, angle)
        return

    if progress < 0.65:
        local = smoothstep((progress - 0.51) / 0.14)
        center_x = 1130 - local * 135 + sway * 14
        paste_sprite(canvas, sprites[2], center_x, 795 + bob * 4, 610, 1, sway * 1.2)
        return

    if progress < 0.83:
        local = smoothstep((progress - 0.65) / 0.18)
        center_x = 960 - local * 90 + sway * 11
        paste_sprite(canvas, sprites[4], center_x, 795 + bob * 5, 575, 1, -1.5 + sway)
        return

    if progress < 0.93:
        local = smoothstep((progress - 0.83) / 0.10)
        center_x = 1045 + math.sin(local * math.pi) * 55
        paste_sprite(canvas, sprites[1], center_x, 802 + bob * 3, 530, 1, sway * 0.8)
        return

    local = smoothstep((progress - 0.93) / 0.07)
    center_x = 1080 - local * 35 + sway * 4
    paste_sprite(canvas, sprites[5], center_x, 803 + bob * 2, 610 + round(local * 18), 1, sway * 0.45)


def draw_scene_transition(canvas, progress):
    transitions = [
        (0.51, CORAL, (1170, 330)),
        (0.65, TURQUOISE, (1020, 470)),
        (0.83, NAVY, (1080, 530)),
        (0.93, DARK, (1040, 480)),
    ]
    for center, color, origin in transitions:
        distance = abs(progress - center)
        if distance >= 0.014:
            continue
        amount = smoothstep(1 - distance / 0.014)
        radius = round(amount * 1500)
        draw = ImageDraw.Draw(canvas, "RGBA")
        draw.ellipse(
            (origin[0] - radius, origin[1] - radius, origin[0] + radius, origin[1] + radius),
            fill=(*color, 255),
        )


def add_stage_copy(canvas, progress):
    if 0.52 <= progress < 0.67:
        canvas.alpha_composite(text_layer("LETREROS 3D\n& LUMINOSOS", DARK, progress, 0.52, 0.67, 150, font(105)))
    elif 0.65 <= progress < 0.84:
        canvas.alpha_composite(text_layer("NEÓN\nBANNERS\nVINILOS", NAVY, progress, 0.65, 0.84, 105, font(112)))
    elif 0.81 <= progress < 0.94:
        canvas.alpha_composite(text_layer("IMPRESIÓN\nVOLANTES\nDISEÑO", WHITE, progress, 0.81, 0.94, 105, font(100)))
    elif progress >= 0.91:
        canvas.alpha_composite(text_layer("TU MARCA\nMERECE\nDESTACAR", WHITE, progress, 0.91, 1.04, 105, font(108)))


def generate():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    resolved_output = OUTPUT.resolve()
    if not resolved_output.is_relative_to(ROOT.resolve()):
        raise RuntimeError("La salida debe permanecer dentro del proyecto")
    for existing in OUTPUT.glob("frame-*.webp"):
        existing.unlink()

    sprites = load_sprites()
    rng = random.Random(404)
    splatters = [
        (rng.randint(50, 900), rng.randint(100, 590), rng.randint(4, 18), rng.random())
        for _ in range(150)
    ]

    for frame_index in range(FRAME_COUNT):
        progress = frame_index / (FRAME_COUNT - 1)
        canvas = Image.new("RGBA", (WIDTH, HEIGHT))
        draw_background(canvas, progress, frame_index)
        draw_title(canvas, progress, splatters)
        draw_neon_sign(canvas, progress)
        draw_print_products(canvas, progress)
        add_stage_copy(canvas, progress)
        draw_mascot(canvas, sprites, progress, frame_index)
        draw_scene_transition(canvas, progress)

        frame_path = OUTPUT / f"frame-{frame_index:03d}.webp"
        output_frame = canvas.convert("RGB")
        output_frame.save(frame_path, "WEBP", quality=82, method=5)
        output_frame.close()
        canvas.close()
        if (frame_index + 1) % 20 == 0:
            print(f"GENERATED={frame_index + 1}/{FRAME_COUNT}", flush=True)
            gc.collect()


if __name__ == "__main__":
    generate()
