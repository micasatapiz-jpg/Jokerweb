import math
import os

import bpy
from mathutils import Vector


OUTPUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public",
    "sequences",
    "letrero-joker-led",
)
FRAME_COUNT = 180


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for data_blocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(data_blocks):
            if block.users == 0:
                data_blocks.remove(block)


def material_principled(name, base_color, metallic=0.0, roughness=0.4, emission=None, strength=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*base_color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = (*emission, 1)
        shader.inputs["Emission Strength"].default_value = strength
    return material


def set_emission_strength(material, strength):
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Emission Strength"].default_value = strength


def add_rounded_cube(name, location, scale, material, bevel=0.12):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (scale[0] / 2, scale[1] / 2, scale[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new("Bordes redondeados", "BEVEL")
    modifier.width = bevel
    modifier.segments = 6
    obj.data.materials.append(material)
    return obj


def add_text(name, body, location, depth, material, size):
    bpy.ops.object.text_add(location=location, rotation=(math.radians(90), 0, 0))
    text = bpy.context.object
    text.name = name
    text.data.body = body
    text.data.align_x = "CENTER"
    text.data.align_y = "CENTER"
    text.data.size = size
    text.data.extrude = depth
    text.data.bevel_depth = 0.035
    text.data.bevel_resolution = 5
    text.data.fill_mode = "BOTH"
    text.data.materials.append(material)
    return text


def add_area(name, location, energy, color, size, target):
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.energy = energy
    light_data.color = color
    light_data.shape = "DISK"
    light_data.size = size
    light = bpy.data.objects.new(name, light_data)
    bpy.context.collection.objects.link(light)
    light.location = location
    direction = Vector(target) - light.location
    light.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return light


def parent_to(objects, parent):
    for obj in objects:
        obj.parent = parent


def add_neon_border(objects):
    segments = []
    positions = []

    # La numeración sigue el perímetro completo para que la luz pueda "correr" sin saltos.
    for index in range(14):
        x = -2.72 + index * (5.44 / 13)
        positions.append(((x, -0.515, 1.34), (0.32, 0.055, 0.055)))
    for index in range(6):
        z = 1.08 - index * (2.16 / 5)
        positions.append(((2.82, -0.515, z), (0.055, 0.055, 0.32)))
    for index in range(13, -1, -1):
        x = -2.72 + index * (5.44 / 13)
        positions.append(((x, -0.515, -1.34), (0.32, 0.055, 0.055)))
    for index in range(5, -1, -1):
        z = 1.08 - index * (2.16 / 5)
        positions.append(((-2.82, -0.515, z), (0.055, 0.055, 0.32)))

    total = len(positions)
    for index, (location, size) in enumerate(positions):
        color = (0.93, 0.52, 0.015) if index % 7 else (0.06, 0.8, 0.69)
        material = material_principled(
            f"Neon borde {index:02d}",
            color,
            metallic=0.08,
            roughness=0.14,
            emission=color,
            strength=0.12,
        )
        segment = add_rounded_cube(
            f"Segmento neon {index:02d}",
            location,
            size,
            material,
            min(size) * 0.44,
        )
        objects.append(segment)
        segments.append((material, index / total))

    return segments


def configure_glow(scene):
    group = bpy.data.node_groups.new("Joker Neon Compositor", "CompositorNodeTree")
    scene.compositing_node_group = group
    render_layers = group.nodes.new("CompositorNodeRLayers")
    glare = group.nodes.new("CompositorNodeGlare")
    group.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    composite = group.nodes.new("NodeGroupOutput")
    glare.inputs["Type"].default_value = "Bloom"
    glare.inputs["Quality"].default_value = "High"
    glare.inputs["Threshold"].default_value = 0.7
    glare.inputs["Strength"].default_value = 0.72
    glare.inputs["Size"].default_value = 0.68
    group.links.new(render_layers.outputs["Image"], glare.inputs["Image"])
    group.links.new(glare.outputs["Image"], composite.inputs["Image"])


def build_scene():
    clear_scene()
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    navy = material_principled("Metal azul marino", (0.010, 0.009, 0.050), metallic=0.82, roughness=0.28)
    gold = material_principled("Marco dorado", (0.89, 0.50, 0.015), metallic=0.9, roughness=0.2)
    black = material_principled("Cuerpo letras", (0.006, 0.008, 0.018), metallic=0.72, roughness=0.24)
    turquoise = material_principled(
        "Acrilico LED turquesa",
        (0.075, 0.74, 0.65),
        metallic=0.05,
        roughness=0.18,
        emission=(0.076, 0.86, 0.75),
        strength=5.2,
    )
    white = material_principled("Herrajes", (0.6, 0.64, 0.7), metallic=0.93, roughness=0.16)

    root = bpy.data.objects.new("Giro del producto", None)
    bpy.context.collection.objects.link(root)

    objects = []
    objects.append(add_rounded_cube("Marco posterior", (0, 0.12, 0), (6.35, 0.28, 3.45), gold, 0.16))
    objects.append(add_rounded_cube("Placa metalica", (0, -0.03, 0), (6.08, 0.46, 3.18), navy, 0.13))
    objects.append(add_rounded_cube("Canal inferior", (0, -0.285, -1.18), (5.15, 0.07, 0.07), gold, 0.025))

    objects.append(add_text("Canal metalico JOKER", "JOKER", (0, -0.27, 0.15), 0.13, black, 1.42))
    objects.append(add_text("Frente acrilico JOKER", "JOKER", (0, -0.425, 0.15), 0.045, turquoise, 1.42))
    neon_segments = add_neon_border(objects)

    for x in (-2.72, 2.72):
        for z in (-1.28, 1.28):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.065, location=(x, -0.29, z))
            bolt = bpy.context.object
            bolt.name = "Tornillo"
            bolt.scale.y = 0.45
            bolt.data.materials.append(white)
            objects.append(bolt)

    parent_to(objects, root)

    bpy.ops.object.camera_add(location=(0, -10.8, 1.0))
    camera = bpy.context.object
    camera.name = "Camara producto"
    camera.data.lens = 55
    camera.data.sensor_width = 36
    camera.rotation_euler = (math.radians(84.7), 0, 0)
    direction = Vector((0, 0, 0)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera

    add_area("Luz principal", (-4.8, -5.2, 5.8), 1150, (0.78, 0.92, 1.0), 4.2, (0, 0, 0))
    add_area("Luz turquesa", (5.2, -3.0, 2.3), 900, (0.20, 1.0, 0.82), 3.2, (0, 0, 0))
    add_area("Contraluz dorada", (-2.5, 3.8, 3.8), 1300, (1.0, 0.48, 0.08), 3.0, (0, 0, 0))
    add_area("Relleno", (0, -2.0, -4.3), 600, (0.32, 0.45, 1.0), 3.5, (0, 0, 0))

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = True
    scene.render.image_settings.compression = 25
    scene.render.use_file_extension = True
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_percentage = 100
    scene.render.fps = 30
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.003, 0.003, 0.009)
    configure_glow(scene)

    for frame in range(1, FRAME_COUNT + 1):
        progress = (frame - 1) / (FRAME_COUNT - 1)
        angle = progress * math.tau
        root.rotation_euler = (0, 0, angle)

        # Encendido: pausa oscura, tres pulsos breves y estabilización brillante.
        if progress < 0.045:
            letter_strength = 0.06
        elif progress < 0.18:
            local = (progress - 0.045) / 0.135
            pulse = max(0.0, math.sin(local * math.pi * 7)) ** 2
            letter_strength = 0.15 + pulse * (2.2 + local * 4.8)
        else:
            breathing = 0.42 * math.sin(progress * math.tau * 2.0)
            letter_strength = 5.5 + breathing
        set_emission_strength(turquoise, letter_strength)
        letter_shader = turquoise.node_tree.nodes.get("Principled BSDF")
        activation = min(max((letter_strength - 0.08) / 5.2, 0.0), 1.0)
        off_color = (0.002, 0.012, 0.018)
        on_color = (0.075, 0.74, 0.65)
        letter_shader.inputs["Base Color"].default_value = (
            *(off_color[index] + (on_color[index] - off_color[index]) * activation for index in range(3)),
            1,
        )

        # Dos cabezas luminosas recorren el borde de neón durante toda la rotación.
        chase = (progress * 3.2) % 1.0
        second_chase = (chase + 0.5) % 1.0
        border_power = min(max((progress - 0.035) / 0.12, 0.0), 1.0)
        for material, position in neon_segments:
            distance_a = min(abs(position - chase), 1.0 - abs(position - chase))
            distance_b = min(abs(position - second_chase), 1.0 - abs(position - second_chase))
            distance = min(distance_a, distance_b)
            head = math.exp(-((distance / 0.07) ** 2))
            tail = math.exp(-((distance / 0.18) ** 2))
            set_emission_strength(material, 0.02 + border_power * (head * 11.0 + tail * 1.9))

        scene.frame_set(frame)
        scene.render.filepath = os.path.join(OUTPUT_DIR, f"frame-{frame:03d}.png")
        bpy.ops.render.render(write_still=True)

    scene.render.filepath = os.path.join(OUTPUT_DIR, "frame-001.png")
    source_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "letrero-joker-led.blend")
    bpy.ops.wm.save_as_mainfile(filepath=source_path)


if __name__ == "__main__":
    build_scene()
