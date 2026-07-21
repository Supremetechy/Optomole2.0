# Optomole Blender export.
#
# Run headless by the build worker:
#   blender --background --python optomole_export.py -- <experience.json> <out.glb>
#
# Reads the injected game spec and builds a scene with one object per compiled
# entity on the deterministic grid from the spec (hazards are red cones, other
# entities cyan cubes), then exports a glTF binary (.glb) a web viewer or engine
# can load.

import bpy
import sys
import os
import json


def script_args():
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def colored_material(name, rgba):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
    return mat


def main():
    args = script_args()
    spec_path = args[0] if len(args) > 0 else "experience.json"
    out_glb = args[1] if len(args) > 1 else "experience.glb"

    with open(spec_path, "r") as handle:
        spec = json.load(handle)

    clear_scene()
    entities = spec.get("entities", [])
    for entity in entities:
        grid = entity.get("grid", {}) or {}
        x = grid.get("col", 0) * 2.5
        y = grid.get("row", 0) * 2.5
        hazard = bool(entity.get("hazard", False))

        if hazard:
            bpy.ops.mesh.primitive_cone_add(radius1=0.6, depth=1.2, location=(x, y, 0.6))
            rgba = (0.90, 0.20, 0.20, 1.0)
        else:
            bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x, y, 0.5))
            rgba = (0.25, 0.80, 0.90, 1.0)

        obj = bpy.context.active_object
        label = (entity.get("label") or entity.get("id") or "entity")[:60]
        obj.name = label
        obj.data.materials.append(colored_material(label + "_mat", rgba))

    out_dir = os.path.dirname(out_glb)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB")
    print("[optomole] exported %d objects -> %s" % (len(entities), out_glb))


main()
