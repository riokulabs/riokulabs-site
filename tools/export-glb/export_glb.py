"""Blender → GLB exporter for the Rioku Labs block viewer (BLOCK-VIEWER.md §2, Route A).

Runs INSIDE Blender against a SCRATCH COPY of the mod's generators (tools/export-glb/build.mjs stages it), never the
mod repo itself:

    blender -b --factory-startup --python export_glb.py -- --ws <scratch workspace> --out <dir> BLOCK [BLOCK ...]

For each block it calls the same builders the game export uses (build_dc.BUILDERS), stops before join/export, and
writes a web-only scene:
  1. LOD0 body + LOD0 subparts, modifiers applied, positioned at their dummies (doors, KVM drawer/screen, fans);
  2. Keen kit parts removed (any object named *_KIT_*, ConveyorPort*, UpgradePort*, Large_Conveyor*) and replaced by
     our own generated frame geometry of the same footprint;
  3. every material slot remapped to the web set (WEB_*; table below). Unknown slots fail the run;
  4. stencil glyph decals remapped to OUR glyph atlas (assets/web-glyphs.json); every other Keen decal quad dropped
     and counted;
  5. animation clips authored as NLA tracks (one glTF animation per track name): DoorsOpen/DoorsClose (85°, the
     game's linear 1 s), KvmOpen/KvmClose (sampled from the CoreTests trajectories at 30 fps), FansSpinUp/FansRun
     (2 s soft start, then a seamless 600 °/s loop);
  6. glTF export (GLB, Y-up, no cameras/lights, NLA-track animations) + <block>.report.json (provenance input).
Materials here carry only names (and debug colours); tools/export-glb/finish.mjs sets the final PBR values and our
textures, compresses with meshopt, and the validator gates the result.
"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


WS = os.path.abspath(arg("--ws"))
OUT = os.path.abspath(arg("--out"))
BLOCKS = [a for i, a in enumerate(ARGS) if not a.startswith("--") and (i == 0 or ARGS[i - 1] not in ("--ws", "--out"))]
# --variants: also <block>.damaged.glb / .fracture.glb / .stages.glb (export_variants); --all-clips: the clips the
# hero set leaves out (the racks' tray fans). Both off by default, so the hero export is unchanged.
VARIANTS = "--variants" in ARGS
ALL_CLIPS = "--all-clips" in ARGS
MODEL_DIR = os.path.join(WS, "mods", "DataCenter", "Source", "Model")
HERE = os.path.dirname(os.path.abspath(__file__))
GLYPHS = json.load(open(os.path.join(HERE, "assets", "web-glyphs.json")))
FPS = 30

# Never let a builder touch the real mod repo: the scratch copy must not live under the workspace's mods/.
REAL_MODS = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "mods"))
assert not os.path.normpath(MODEL_DIR).startswith(REAL_MODS + os.sep), "refusing to build inside the real mods/"

sys.path.insert(0, MODEL_DIR)
sys.path.insert(0, os.path.join(WS, "tools"))

# ---------------------------------------------------------------------------------------------- web materials
# slot base name (Keen library name or our custom slot) -> web material
WEB = {
    "PaintedMetalColorable": "WEB_Paint", "PaintedMetalGrey": "WEB_Paint",
    "PaintedMetalDarker": "WEB_Darker", "FracturedMaterial01": "WEB_Darker",
    "PaintedMetalYellow": "WEB_Yellow",
    "BrushedMetal": "WEB_Steel",
    "MetalPerforationSteel": "WEB_Perf",
    "MetalDull": "WEB_Hardware",
    "Chrome": "WEB_Chrome",
    "Rubber": "WEB_Rubber",
    "ClearGlass": "WEB_Glass", "WindowGlassThin": "WEB_Glass", "WindowGlass": "WEB_Glass", "FrostedGlass": "WEB_GlassFrosted",
    "ConveyorsAtlas": "WEB_Port",
    "EmissiveOff": "WEB_LampOff", "EmissiveOffBroken": "WEB_LampOff",
    "EmissiveGreen": "WEB_LampGreen", "EmissiveStatus": "WEB_LampGreen", "EmissiveScriptStatus": "WEB_LampGreen",
    "EmissiveRed": "WEB_LampRed", "EmissiveAmber": "WEB_LampAmber", "EmissiveWhite": "WEB_LampWhite",
    "EmissiveColorable": "WEB_LampWhite",
    "Terminal": "WEB_Screen", "LCD": "WEB_Screen", "ScreenArea": "WEB_Screen",   # in-game LCD surfaces
    "AtlasFont_BarlowCondensed": "WEB_Glyphs", "AtlasFont_BarlowCondensed_CleanWhite": "WEB_GlyphsWhite",
    # the rest of the catalogue (signs' 4:1 LCDs, extra lamp slots) and the Damaged models' slot swaps
    # (fracture.DAMAGED_SLOTS: the slot keeps its mesh part, the .model maps it to the broken material)
    "LCDScreen_Off": "WEB_Screen", "LCDScreen_Off_4": "WEB_Screen", "LCDScreen_Off_4_Back": "WEB_Screen",
    "Emissive01": "WEB_LampWhite", "Emissive02": "WEB_LampWhite",
    "PaintedMetalColorableDeformed": "WEB_Paint", "PaintedMetalDarkerDeformed": "WEB_Darker",
    "BrushedMetalDeformed": "WEB_Hardware", "ChromeDeformed": "WEB_Hardware",
    "Display01Broken": "WEB_LampOff", "LCDScreen_Off_Damaged": "WEB_LampOff",
    "WindowGlassBroken": "WEB_GlassFrosted", "WindowGlassBrokenThin": "WEB_GlassFrosted",
}
SUBPART_SUFFIX = "_Subpart"   # fracture.SUBPART_SUFFIX: a baked stand-in's slot is <Mat>_Subpart (same material)


def slot_base(name):
    n = name.split(".")[0]
    return n[:-len(SUBPART_SUFFIX)] if n.endswith(SUBPART_SUFFIX) else n
DROP_PREFIX = ("AtlasDecal_",)                    # Keen decal atlases: dropped in v1 (counted)
KIT_MARKERS = ("_KIT_", "ConveyorPort", "UpgradePort", "Large_Conveyor", "Fracture_")
DEBUG_COLOUR = {"WEB_Paint": (0.40, 0.41, 0.43), "WEB_Darker": (0.07, 0.075, 0.08), "WEB_Yellow": (0.85, 0.55, 0.05)}


def web_material(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf and name in DEBUG_COLOUR:
            bsdf.inputs["Base Color"].default_value = (*DEBUG_COLOUR[name], 1)
    return m


# ---------------------------------------------------------------------------------------------- mesh helpers
def bake(objs, name, coll):
    """One mesh object from many: modifiers applied (bevels), world transforms baked into a common frame."""
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    mats = []
    for o in objs:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        me.transform(o.matrix_world)
        remap = {}
        for i, m in enumerate(me.materials):
            if m not in mats:
                mats.append(m)
            remap[i] = mats.index(m)
        for p in me.polygons:
            p.material_index = remap.get(p.material_index, 0)
        bm.from_mesh(me)   # appends to the running bmesh, keeping material indices
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def world_bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def place(objs, M):
    """Set the world matrix of builder objects (they are built in their own local frame)."""
    for o in objs:
        o.matrix_world = M @ o.matrix_world


# ---------------------------------------------------------------------------------------------- kit replacement
def replacement_frame(lo, hi, coll, name):
    """Our own chamfered square port frame over a kit part's footprint: a ring in the plane of the kit's thinnest
    axis, outer = its bounding box, inner opening 64 %, 45° chamfered outer corners, depth = its thickness."""
    size = hi - lo
    thin = min(range(3), key=lambda i: size[i])
    a, b = [i for i in range(3) if i != thin]
    c = (lo + hi) / 2
    oa, ob_ = size[a] / 2, size[b] / 2
    ia, ib = oa * 0.64, ob_ * 0.64
    ch = min(oa, ob_) * 0.18
    depth = max(size[thin], 0.012)

    def P(u, v, w):
        p = [0.0, 0.0, 0.0]
        p[a], p[b], p[thin] = c[a] + u, c[b] + v, c[thin] + w
        return p

    outer = [(-oa + ch, -ob_), (oa - ch, -ob_), (oa, -ob_ + ch), (oa, ob_ - ch), (oa - ch, ob_), (-oa + ch, ob_), (-oa, ob_ - ch), (-oa, -ob_ + ch)]
    inner = [(-ia, -ib), (ia, -ib), (ia, -ib), (ia, ib), (ia, ib), (-ia, ib), (-ia, ib), (-ia, -ib)]
    bm = bmesh.new()
    vs = {}
    for side, w in (("f", depth / 2), ("k", -depth / 2)):
        vs[side + "o"] = [bm.verts.new(P(u, v, w)) for u, v in outer]
        vs[side + "i"] = [bm.verts.new(P(u, v, w)) for u, v in inner]
    n = len(outer)
    for side in ("f", "k"):
        for i in range(n):
            j = (i + 1) % n
            try:
                bm.faces.new((vs[side + "o"][i], vs[side + "o"][j], vs[side + "i"][j], vs[side + "i"][i]))
            except ValueError:
                pass
    for ring in ("o", "i"):
        for i in range(n):
            j = (i + 1) % n
            try:
                bm.faces.new((vs["f" + ring][i], vs["f" + ring][j], vs["k" + ring][j], vs["k" + ring][i]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(web_material("WEB_Yellow"))   # the renders show the service-port frames in yellow
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def strip_kit(objs, coll, report):
    keep = []
    for o in objs:
        # kit parts are named on the object or (se2model KitPart) on the mesh datablock: CRACPORT_KIT_*, CELLBAY_KIT_*
        if o.get("WEB_KIT") or any(k in o.name or k in o.data.name for k in KIT_MARKERS):
            lo, hi = world_bounds([o])
            frame = replacement_frame(lo, hi, coll, f"WebPortFrame_{len(report['kit_replaced'])}")
            report["kit_replaced"].append({"removed": f"{o.name} (mesh {o.data.name})", "replaced_by": frame.name, "size_m": [round(x, 3) for x in (hi - lo)]})
            keep.append(frame)
        else:
            keep.append(o)
    return keep


# ---------------------------------------------------------------------------------------------- materials + decals
def remap(ob, report, slot_map=None):
    """Web materials by slot name; glyph quads → our atlas; other Keen decal quads dropped. slot_map: a slot-name
    swap applied first (the Damaged model's broken materials, fracture.damaged_slot)."""
    me = ob.data
    old = [slot_base(m.name) if m else "" for m in me.materials]
    if slot_map:
        old = [slot_map(n) if n else n for n in old]
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active or (bm.loops.layers.uv[0] if len(bm.loops.layers.uv) else None)
    drop = []
    glyph_hits = 0
    for f in bm.faces:
        slot = old[f.material_index] if f.material_index < len(old) else ""
        if slot.startswith("AtlasDecal_Stickers"):
            kind, cell = classify_sticker(slot, [(l[uv].uv.x, l[uv].uv.y) for l in f.loops])
            if kind:
                remap_sticker(f, uv, kind, cell)
                report["stickers_redrawn"][f"{kind}:{cell}"] = report["stickers_redrawn"].get(f"{kind}:{cell}", 0) + 1
                continue
            drop.append(f)
            report["decals_dropped"][f"{slot} ({cell})"] = report["decals_dropped"].get(f"{slot} ({cell})", 0) + 1
            continue
        if slot.startswith(DROP_PREFIX):
            drop.append(f)
            report["decals_dropped"][slot] = report["decals_dropped"].get(slot, 0) + 1
            continue
        if slot.startswith("AtlasFont"):
            px = 1024.0 if slot.endswith("CleanWhite") else 2048.0
            us = [l[uv].uv.x for l in f.loops]
            vs = [l[uv].uv.y for l in f.loops]
            u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
            box = (u0 * px, (1 - v1) * px, u1 * px, (1 - v0) * px)
            ch = match_glyph(box)
            if ch is None:
                drop.append(f)
                report["decals_dropped"]["unmatched_glyph"] = report["decals_dropped"].get("unmatched_glyph", 0) + 1
                continue
            gx0, gy0, gx1, gy1 = GLYPHS["boxes"][ch]
            S = GLYPHS["size"]
            for l in f.loops:
                fu = (l[uv].uv.x - u0) / max(u1 - u0, 1e-9)
                fv = (l[uv].uv.y - v0) / max(v1 - v0, 1e-9)
                l[uv].uv = ((gx0 + fu * (gx1 - gx0)) / S, 1 - (gy1 - fv * (gy1 - gy0)) / S)
            glyph_hits += 1
    report["glyphs_remapped"] += glyph_hits
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.to_mesh(me)
    bm.free()
    new = []
    for name in old:
        if name.startswith("AtlasDecal_Stickers"):
            new.append(web_material("WEB_Decals"))   # remapped onto OUR decal atlas
            report["materials"]["WEB_Decals"] = sorted(set(report["materials"].get("WEB_Decals", []) + [name]))
            continue
        if name.startswith(DROP_PREFIX) or not name:
            new.append(web_material("WEB_Darker"))   # slot now unused (faces deleted)
            continue
        web = name if name.startswith("WEB_") else WEB.get(name)   # our own replacement geometry is already web
        if web is None:
            report["unknown_materials"].append(name)
            web = "WEB_Darker"
        report["materials"][web] = sorted(set(report["materials"].get(web, []) + [name]))
        new.append(web_material(web))
    for i, m in enumerate(new):
        me.materials[i] = m
    # merge duplicate slots
    names = [m.name for m in me.materials]
    first = {n: names.index(n) for n in names}
    for p in me.polygons:
        p.material_index = first[names[p.material_index]]
    if len(me.polygons) == 0:
        return False
    return True


# Keen sticker element -> the cell of OUR decal atlas (assets/web-decals.json) drawn in its place. Our own art
# (make_assets.py): hazard triangles, stripe bands, re-typeset warning placards, simple icons. Unknown -> dropped.
STICKER_CELLS = {
    "danger_hv": "danger_hv", "moving_parts": "caution_moving", "hv_supply": "warn_hv_supply",
    "caution_maint": "caution_maint", "warn_instr": "warn_instructions", "remote_operated": "remote_operated",
    "barcode_long": "barcode", "tri_electric": "tri_electric", "tri_hot": "tri_hot",
    "chevrons": "chevrons", "warning_tri": "tri_general", "power": "power", "bolt_hazard": "bolt", "arrow_right": "arrow", "lock": "lock",
}
DECALS = json.load(open(os.path.join(HERE, "assets", "web-decals.json")))


def classify_sticker(slot, uvs, tol=2e-3):
    """(kind, our cell) for a Keen sticker face from its UVs: ('tri', cell) | ('rect', cell) | ('band', colour) |
    (None, reason)."""
    from se2model import decals as D
    us, vs = [u for u, _ in uvs], [v for _, v in uvs]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    if slot.startswith("AtlasDecal_Stickers02"):
        if len(uvs) == 3:
            for key in D.HAZARD_TRIANGLES:
                want, _ = D.hazard_triangle_uv(key)
                if all(min(abs(a - x) + abs(b - y) for x, y in uvs) < tol * 4 for a, b in want):
                    return "tri", STICKER_CELLS[key]
            return None, "unmatched triangle"
        for colour, (r0, r1) in D.STRIPE_ROWS.items():
            if abs(v0 - (1 - r1 / 2048)) < tol and abs(v1 - (1 - r0 / 2048)) < tol:
                return "band", colour
        for key in D.STICKERS02:
            e = D.element_uv(D.S2, key)
            if all(abs(x - y) < tol for x, y in zip((u0, v0, u1, v1), e)):
                return ("rect", STICKER_CELLS[key]) if key in STICKER_CELLS else (None, "no cell")
        return None, "unmatched Stickers02 rect"
    if slot.startswith("AtlasDecal_Stickers01"):
        for key in D.STICKERS01:
            for variant in D.STICKERS01_OFFSET:
                e = D.element_uv(D.S1, key, variant)
                if all(abs(x - y) < tol for x, y in zip((u0, v0, u1, v1), e)):
                    cell = STICKER_CELLS.get(key)
                    if not cell:
                        return None, "no cell"
                    return "rect", cell + ("_white" if variant.startswith("white") else "")
        return None, "unmatched Stickers01 rect"
    return None, "not a sticker"


def remap_sticker(face, uv, kind, cell):
    """Point a sticker face's UVs at our atlas cell (same orientation: the old rect/triangle maps linearly)."""
    S = DECALS["size"]
    pts = [l[uv].uv.copy() for l in face.loops]
    if kind == "rect":
        x0, y0, x1, y1 = DECALS["cells"][cell]
        us, vs = [p.x for p in pts], [p.y for p in pts]
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
        for l, p in zip(face.loops, pts):
            fu = (p.x - u0) / max(u1 - u0, 1e-9)
            fv = (p.y - v0) / max(v1 - v0, 1e-9)
            l[uv].uv = ((x0 + fu * (x1 - x0)) / S, 1 - (y1 - fv * (y1 - y0)) / S)
    elif kind == "tri":
        from se2model import decals as D
        key = next(k for k, v in STICKER_CELLS.items() if v == cell and k in D.HAZARD_TRIANGLES)
        want, _ = D.hazard_triangle_uv(key)       # (base-left, base-right, apex) in Keen UVs
        ours = DECALS["triangles"][cell]           # same order, our atlas px
        for l, p in zip(face.loops, pts):
            i = min(range(3), key=lambda k: abs(want[k][0] - p.x) + abs(want[k][1] - p.y))
            x, y = ours[i]
            l[uv].uv = (x / S, 1 - y / S)
    elif kind == "band":
        y0, y1 = DECALS["bands"][cell]
        # Keen bands are 32 px of a 2048 atlas; ours are (y1 - y0) px of S: scale U so the stripes keep their shape
        k = ((y1 - y0) / S) / (32 / 2048)
        for l, p in zip(face.loops, pts):
            fv = (p.y - (1 - (DECALS["keen_rows"][cell][1]) / 2048)) / (32 / 2048)
            l[uv].uv = (p.x * k, 1 - (y1 - fv * (y1 - y0)) / S)


def match_glyph(box, tol=1.6):
    from se2model import decals as D
    for ch, g in D.GLYPHS.items():
        if all(abs(box[i] - g[i]) <= tol for i in range(4)):
            return ch
    return None


# ---------------------------------------------------------------------------------------------- animation
def T(x, y, z):
    return Matrix.Translation((x, y, z))


def Rz(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def Rx(deg):
    return Matrix.Rotation(math.radians(deg), 4, "X")


def key_track(ob, track, samples):
    """samples: [(t seconds, world Matrix)] → an action on ob, pushed to an NLA track named `track`."""
    ob.rotation_mode = "QUATERNION"
    ob.animation_data_create()
    act = bpy.data.actions.new(f"{track}__{ob.name}")
    ob.animation_data.action = act
    for t, M in samples:
        loc, rot, _ = M.decompose()
        f = 1 + t * FPS
        ob.location = loc
        ob.rotation_quaternion = rot
        ob.keyframe_insert("location", frame=f)
        ob.keyframe_insert("rotation_quaternion", frame=f)
    tr = ob.animation_data.nla_tracks.new()
    tr.name = track
    tr.strips.new(track, 1, act)
    ob.animation_data.action = None


def rest(ob, M):
    ob.rotation_mode = "QUATERNION"
    ob.matrix_world = M


def spin_clips(rotors, w, up, report):
    """FansSpinUp (linear speed-up `up` °/s² to `w` °/s) + FansRun (one seamless revolution) on [(ob, base(angle))]."""
    tr = w / up
    spin = [(i / FPS, 0.5 * up * (i / FPS) ** 2) for i in range(int(round(tr * FPS)) + 1)]
    a_end = spin[-1][1]
    period = 360.0 / w
    steps = 12
    run = [(period * k / steps, a_end + 360.0 * k / steps) for k in range(steps + 1)]
    for ob, base in rotors:
        key_track(ob, "FansSpinUp", [(t, base(a)) for t, a in spin])
        key_track(ob, "FansRun", [(t, base(a)) for t, a in run])
        rest(ob, base(a_end % 360.0))
    report["clips"]["FansSpinUp"] = {"seconds": round(tr, 3), "source": f"{w} °/s, speed-up {up} °/s²"}
    report["clips"]["FansRun"] = {"seconds": round(period, 3), "loop": True, "source": f"one revolution at {w} °/s"}


def export_scene(scene, path, animations=True):
    with bpy.context.temp_override(scene=scene):
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_active_scene=True, export_apply=True, export_cameras=False,
            export_lights=False, export_yup=True, export_animations=animations, export_animation_mode="NLA_TRACKS",
            export_force_sampling=True, export_frame_range=False, export_optimize_animation_size=True,
            export_materials="EXPORT", export_image_format="NONE", export_texcoords=True, export_normals=True,
            export_tangents=False, export_extras=False)


# ---------------------------------------------------------------------------------------------- variants
# The Fractured / Damaged models come from the mod's own exporter (dc/export_models.export_block) run in THIS process
# on the scratch copy: its two FBX writers are swapped for captures (no file is written, no VRAGE Tools needed), so
# the cut zones, break caps, scaffold, stand-ins and dents are exactly what the game export makes. Kit parts are
# replaced by our port frame in the built LODs first, so no Keen mesh reaches the cut.
CAPTURE = {}

# construction materials (BuildProgressModels SetMaterial GUIDs, dc/construction.PRESETS) -> our flat web stand-ins
BUILD_MATS = {
    # one look per sequence step (construction.PRESETS "default": T at 0 / 0.1 / 0.2, S at 0.3 / 0.533 / 0.767), so
    # every stage of the mod's BuildProgressModels reads differently: a ghost that firms up, then primer to finish
    "2a8225c1-df6c-41a7-ad6f-b58a77bdd88d": "WEB_BuildGhost1", "d5d7f641-9756-4776-abb5-ffd52f2f80a8": "WEB_BuildGhost2",
    "9f97552e-a56c-4f5a-8c6c-3be96ab453f5": "WEB_BuildGhost3",          # transparent sequence 1..3
    "857c023a-0cbb-43e0-9af4-5ce18d9ab587": "WEB_BuildPrimer1", "f49fee87-8abf-4faf-89d1-d49b9ef46a0b": "WEB_BuildPrimer2",
    "851d4d6e-9ec8-467f-87a5-06ef06e97336": "WEB_BuildPrimer3",         # solid sequence 1..3 / SubpartConstruct
    "4050183d-1340-4643-b8b9-124981f2121d": "WEB_Scaffold",             # scaffolding / support sequence 1
    "0c3be477-8bff-4e2c-8a0e-d7d842905ae9": "WEB_Steel",                # support sequence 2 (brushed metal)
    "0f2772fd-72d6-4ee9-9211-38d1781ba8b9": "WEB_Darker",               # fracture preset (break faces)
    "83c075f5-f177-460d-94a7-8aca19fd4d6f": "WEB_Glass",                # WindowGlass preset
    "2cc33fe2-00c5-4a64-a648-d1ea7aa8e3ee": "WEB_Steel",                # GratingMetallic preset
}


def install_capture():
    from se2model import export as EX

    def fbx(objs, path, ops):
        base = os.path.basename(path)
        for kind, suffix in (("fr", "_Fractured.fbx"), ("dm", "_Damaged.fbx")):
            if base == CAPTURE.get("name", "") + suffix:
                coll = bpy.data.collections.get("WEB_capture") or bpy.data.collections.new("WEB_capture")
                out = []
                for o in objs:
                    if o.type != "MESH" or not len(o.data.polygons):
                        continue
                    c = o.copy()
                    c.data = o.data.copy()
                    c.matrix_world = o.matrix_world.copy()
                    coll.objects.link(c)
                    out.append(c)
                CAPTURE[kind] = out

    EX.export_fbx = fbx
    EX.export_collision = lambda objs, path, ops: {}


def replace_kit_in_lods(built, report):
    """Swap every kit object in the built LODs for our port frame (with a UV layer: the cut copies UVs)."""
    n = 0
    for coll, objs in built["lods"]:
        new = []
        for o in objs:
            if o.type == "MESH" and (o.get("WEB_KIT") or any(k in o.name or k in o.data.name for k in KIT_MARKERS[:-1])):
                lo, hi = world_bounds([o])
                fr = replacement_frame(lo, hi, coll, f"WebPortFrameV_{n}")
                fr.data.uv_layers.new(name="UVMap")
                n += 1
                new.append(fr)
            else:
                new.append(o)
        objs[:] = new
    report["variants_kit_replaced"] = n


def lifted(objs, M):
    out = []
    for o in objs:
        c = o.copy()
        c.data = o.data.copy()
        c.matrix_world = M @ o.matrix_world
        bpy.context.scene.collection.objects.link(c)
        out.append(c)
    return out


def bake_web(objs, nm, coll, M, report, slot_map=None, centre=False):
    """bake() + remap() of copies of objs at M; centre: the node's origin at its bounding-box centre."""
    tmp = lifted(objs, M)
    ob = bake(tmp, nm, coll)
    for c in tmp:
        bpy.data.objects.remove(c, do_unlink=True)
    if not remap(ob, report, slot_map):
        bpy.data.objects.remove(ob, do_unlink=True)
        return None
    if centre:
        vs = [v.co for v in ob.data.vertices]
        c = Vector([(min(v[i] for v in vs) + max(v[i] for v in vs)) / 2 for i in range(3)])
        ob.data.transform(Matrix.Translation(-c))
        ob.location = c
    return ob


def mesh_tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def split_by_slot(o):
    """[(slot name, object holding only that slot's faces)] of a captured FR object (the importer's mesh parts)."""
    out = []
    used = sorted({p.material_index for p in o.data.polygons})
    for i in used:
        m = o.data.materials[i] if i < len(o.data.materials) else None
        c = o.copy()
        c.data = o.data.copy()
        bm = bmesh.new()
        bm.from_mesh(c.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != i], context="FACES")
        bm.to_mesh(c.data)
        bm.free()
        out.append((m.name if m else "", c))
    return out


def export_variants(name, spec, built, M0, report):
    import build_dc
    from dc import construction as CO, export_models as XM, fracture as FR, state_view as SV
    v = report.setdefault("variants", {})
    replace_kit_in_lods(built, report)
    CAPTURE.clear()
    CAPTURE["name"] = name
    man = XM.export_block(spec, built["lods"], built["collision"], built["boxes"], object(),
                          subparts=built.get("subparts"), subpart_collision=built.get("subpart_collision"),
                          mid=built.get("mid"))
    fr_objs, dm_objs = CAPTURE.get("fr") or [], CAPTURE.get("dm") or []
    frm = man.get("fractured") or {}
    zones = {z["id"]: z for z in frm.get("zones") or []}
    crit = set(frm.get("critical") or [])

    # ---- damaged: the Damaged LOD0 (no scaffold, stand-ins in), slots swapped as the Damaged .model maps them
    if dm_objs:
        sc = bpy.data.scenes.new(f"WEB_{name}_damaged")
        ob = bake_web(dm_objs, "Body", sc.collection, M0, report, slot_map=FR.damaged_slot)
        export_scene(sc, os.path.join(OUT, f"{name}.damaged.glb"), animations=False)
        v["damaged"] = {"tris": mesh_tris(ob), "dent": (man.get("damaged") or {}).get("dent"),
                        "source": "dc/export_models Damaged LOD0 (densified + dented), slots per fracture.DAMAGED_SLOTS"}
    else:
        v["damaged"] = None
        v.setdefault("missing", {})["damaged"] = "the mod's exporter made no Damaged model for this block"

    # ---- fracture: the Fractured LOD0 split per zone (scaffold left out), each zone one node at its centre
    # (the exporter strips dc_scaffold before its FBX write: the cage is the Scaffold-type object)
    is_scaffold = lambda o: o.get("ConstructionMeshType") == "Scaffold" or o.name.endswith("_Scaffold")  # noqa: E731
    pieces = [o for o in fr_objs if not is_scaffold(o)]
    by_zone = {}
    for o in pieces:
        z = SV.zone_of(o.get("Group")) or "Base"
        by_zone.setdefault(z, []).append(o)
    if zones and len(by_zone) > 1:
        sc = bpy.data.scenes.new(f"WEB_{name}_fracture")
        nodes = []
        for z, objs in sorted(by_zone.items()):
            node = "Frac_" + (z.rsplit("_", 1)[-1] if z != "Base" else "Base")
            ob = bake_web(objs, node, sc.collection, M0, report, centre=True)
            if ob is None:
                continue
            zi = zones.get(z, {})
            nodes.append({"node": node, "zone": z, "critical": z in crit, "health_share": zi.get("health_share"),
                          "tris": mesh_tris(ob), "centre_m": [round(x, 4) for x in ob.location]})
        export_scene(sc, os.path.join(OUT, f"{name}.fracture.glb"), animations=False)
        v["fracture"] = {"nodes": nodes, "kind": frm.get("kind"), "note": "centre_m: Blender Z-up block frame"}
    else:
        v["fracture"] = None
        v.setdefault("missing", {})["fracture"] = ("unfractured (non-breakable by design, fracture.UNFRACTURED)"
                                                   if not zones else "a single fracture zone")

    # ---- construction stages: the Fractured LOD0 (scaffold included) through the generated BuildProgressModels
    parts = {k: tuple(x) for k, x in (frm.get("parts") or {}).items()}
    if fr_objs and parts:
        stages = CO.generate_stages(parts, "model", "fracture", seed=f"datacenter/{name}",
                                    damaged_hide=CO.scaffold_parts(parts))
        ratios = [s["Value"]["BuildRatioLowerBound"] for s in stages if s["Value"]["BuildRatioLowerBound"] < 1]
        sc = bpy.data.scenes.new(f"WEB_{name}_stages")
        base = {}      # part -> [(object, mesh)] in skin materials
        k = 0
        for o in fr_objs:
            g = o.get("Group")
            for slot, c in split_by_slot(o):
                part = f"{g}-{slot}" if g else slot
                bpy.context.scene.collection.objects.link(c)
                ob = bake_web([c], f"Part_{k}", sc.collection, M0, report)
                bpy.data.objects.remove(c, do_unlink=True)
                k += 1
                if ob is None:
                    continue
                sc.collection.objects.unlink(ob)
                base.setdefault(part, []).append(ob.data)
                bpy.data.objects.remove(ob)
        override = {}

        def mesh_for(me, guid):
            if not guid:
                return me
            web = BUILD_MATS.get(guid)
            if web is None:
                report.setdefault("unknown_build_materials", []).append(guid)
                web = "WEB_BuildPrimer2"
            key = (me.name, web)
            if key not in override:
                m2 = me.copy()
                m2.name = f"{me.name}_{web[4:]}"
                for i in range(len(m2.materials)):
                    m2.materials[i] = web_material(web)
                override[key] = m2
            return override[key]

        nodes = []
        prev, si, merged_into = None, 0, {}
        for r in ratios:
            st = SV.part_state(stages, r)
            # what this stage shows: (part, web material) of every visible part; a stage that looks exactly like the
            # one before it (no part or material change in web terms) is folded into it, so Stage_1..K all differ
            look = tuple(sorted((p, BUILD_MATS.get(st.get(p, (True, None))[1]) or "skin")
                                for p in base if st.get(p, (True, None))[0]))
            if look == prev:
                merged_into.setdefault(f"Stage_{si}", []).append(round(r, 4))
                continue
            prev = look
            si += 1
            root = bpy.data.objects.new(f"Stage_{si}", None)
            sc.collection.objects.link(root)
            shown = 0
            for part, meshes in base.items():
                vis, mat = st.get(part, (True, None))
                if not vis:
                    continue
                for me in meshes:
                    ch = bpy.data.objects.new(f"S{si}_{me.name}", mesh_for(me, mat))
                    sc.collection.objects.link(ch)
                    ch.parent = root
                    shown += 1
            nodes.append({"node": f"Stage_{si}", "build_ratio": round(r, 4), "objects": shown,
                          "materials": sorted({m for _, m in look})})
        for n in nodes:
            if n["node"] in merged_into:
                n["also_ratios"] = merged_into[n["node"]]
        export_scene(sc, os.path.join(OUT, f"{name}.stages.glb"), animations=False)
        v["stages"] = {"count": len(nodes), "nodes": nodes, "parts": len(base), "mod_stage_ratios": [round(r, 4) for r in ratios],
                       "scaffold": any(is_scaffold(o) for o in fr_objs),
                       "source": "dc/construction.generate_stages over the Fractured LOD0 mesh parts, "
                                 "state_view.part_state per stage (as the game's BuildProgressModels)"}
    else:
        v["stages"] = None
        v.setdefault("missing", {})["stages"] = "no Fractured model / construction parts"
    for o in fr_objs + dm_objs:
        bpy.data.objects.remove(o, do_unlink=True)


# ---------------------------------------------------------------------------------------------- per block
def export_block(name):
    import build_dc
    from dc import catalog, doors, crac
    from dc import subparts as S

    spec = catalog.BY_NAME[name]
    build_dc.BUILDERS[spec.family](spec, False)
    built = build_dc.BUILT[name]
    report = {"block": name, "kit_replaced": [], "decals_dropped": {}, "glyphs_remapped": 0, "stickers_redrawn": {}, "materials": {},
              "unknown_materials": [], "nodes": {}, "clips": {}}

    scene = bpy.data.scenes.new(f"WEB_{name}")
    coll = scene.collection
    body_src = [o for o in built["lods"][0][1] if o.type == "MESH"]
    lo, hi = world_bounds(body_src)
    dz = -lo.z
    M0 = T(0, 0, dz)   # the block's centred frame lifted so its floor is at z = 0

    def bake_at(objs, nm, M):
        tmp = []
        for o in objs:
            if o.type != "MESH":
                continue
            c = o.copy()          # (copies keep custom properties such as WEB_KIT)
            c.data = o.data.copy()
            c.matrix_world = M @ o.matrix_world
            bpy.context.scene.collection.objects.link(c)
            tmp.append(c)
        objs2 = strip_kit(tmp, bpy.context.scene.collection, report)
        ob = bake(objs2, nm, coll)
        for c in objs2:
            bpy.data.objects.remove(c, do_unlink=True)
        if not remap(ob, report):
            bpy.data.objects.remove(ob, do_unlink=True)
            return None
        report["nodes"][nm] = {"source": f"build_dc.{build_dc.BUILDERS[spec.family].__name__} LOD0", "tris": sum(len(p.vertices) - 2 for p in ob.data.polygons)}
        return ob

    def sub_objs(model):
        return [o for o in built["subparts"][model][0][1] if o.type == "MESH"]

    body = bake_at(body_src, "Body", M0)

    sub = built.get("subparts") or {}
    if spec.family == "rack":
        C = M0
        if "RackSide" in sub:
            for yaw in (0, 180):
                bake_at(sub_objs("RackSide"), f"RackSide_{yaw}", C @ Rz(yaw))
        leaves = []
        for lf in doors.leaves(spec):
            ob = bake_at(sub_objs(lf["model"]), f"Door_{lf['name']}", Matrix.Identity(4))
            pose = lambda f, lf=lf: C @ T(lf["axis"][0], lf["axis"][1], 0) @ Rz(doors.swing_yaw(lf, f))
            rest(ob, pose(0.0))
            leaves.append((ob, pose))
        tp = doors.fan_tray_point(spec)
        if tp:
            bake_at(sub_objs(doors.FAN_TRAY_SUB), "FanTray", C @ T(*tp))
        fans = []
        for i, p in enumerate(doors.fan_points(spec)):
            base = lambda a, p=p, i=i: C @ T(*p) @ Rz(37 * i + a)   # noqa: E731
            if ALL_CLIPS:      # animated: the mesh in the rotor's own frame, the pose on the node
                ob = bake_at(sub_objs(doors.FAN), f"RackFan_{i}", Matrix.Identity(4))
                rest(ob, base(0.0))
                fans.append((ob, base))
            else:              # the hero export: static rotors baked in place (unchanged)
                bake_at(sub_objs(doors.FAN), f"RackFan_{i}", base(0.0))
        if ALL_CLIPS and fans:
            # the tray rotors' InfiniteRotation (integration.FAN_ANIM: 720 °/s about the game's +Y = Blender +Z,
            # speed-up 360 °/s²): a 2 s soft start, then one seamless revolution
            spin_clips(fans, 720.0, 360.0, report)
        n = FPS  # 1 s linear, as the game's door (OpeningDuration)
        for track, f0, f1 in (("DoorsOpen", 0.0, 1.0), ("DoorsClose", 1.0, 0.0)):
            for ob, pose in leaves:
                key_track(ob, track, [(i / FPS, pose(f0 + (f1 - f0) * i / n)) for i in range(n + 1)])
            report["clips"][track] = {"seconds": 1.0, "nodes": [o.name for o, _ in leaves], "source": "doors.swing_yaw (85°), linear 1 s"}
        for ob, pose in leaves:
            rest(ob, pose(0.0))

    elif spec.family == "server" and S.DRAWER in sub:
        m = M0
        drawer = bake_at(sub_objs(S.DRAWER), "KvmDrawer", Matrix.Identity(4))
        screen = bake_at(sub_objs(S.SCREEN), "KvmScreen", Matrix.Identity(4))

        def poses(slide, fold):
            md = m @ T(S.HINGE[0], S.HINGE[1] + S.TRAVEL * slide, S.HINGE[2])
            return md, md @ Rx(S.FOLD_DEG * fold)

        from dc import kvm_motion as K
        for track, traj in (("KvmOpen", "open"), ("KvmClose", "close")):
            rows = K.load(traj)
            dur = rows[-1][0]
            samples = []
            j = 0
            for i in range(int(math.ceil(dur * FPS)) + 1):
                t = min(dur, i / FPS)
                while j + 1 < len(rows) and rows[j + 1][0] <= t:
                    j += 1
                a, b = rows[j], rows[min(j + 1, len(rows) - 1)]
                k = 0.0 if b[0] <= a[0] else (t - a[0]) / (b[0] - a[0])
                slide, fold = a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k
                samples.append((t, slide, fold))
            key_track(drawer, track, [(t, poses(s, f)[0]) for t, s, f in samples])
            key_track(screen, track, [(t, poses(s, f)[1]) for t, s, f in samples])
            report["clips"][track] = {"seconds": round(dur, 3), "frames": len(samples), "nodes": ["KvmDrawer", "KvmScreen"],
                                      "source": f"CoreTests trajectory {traj}.csv (kvm_motion.load), 30 fps"}
        md, ms = poses(0, 0)
        rest(drawer, md)
        rest(screen, ms)

    elif spec.family == "crac":
        FAN = crac.FAN
        rotors = []
        for i, p in enumerate(crac.fan_points(spec)):
            ob = bake_at(sub_objs(FAN), f"CracFan_{i}", Matrix.Identity(4))
            base = lambda a, p=p, i=i: M0 @ T(*p) @ Matrix.Rotation(math.radians(a + 23.0 * i), 4, Vector((0, -1, 0)))
            rest(ob, base(0))
            rotors.append((ob, base))
        w, up = crac.FAN_DEG_S, crac.FAN_SPEEDUP
        tr = w / up
        spin = [(i / FPS, 0.5 * up * (i / FPS) ** 2) for i in range(int(round(tr * FPS)) + 1)]
        a_end = spin[-1][1]
        period = 360.0 / w
        steps = 12
        run = [(period * k / steps, a_end + 360.0 * k / steps) for k in range(steps + 1)]
        for ob, base in rotors:
            key_track(ob, "FansSpinUp", [(t, base(a)) for t, a in spin])
            key_track(ob, "FansRun", [(t, base(a)) for t, a in run])
            rest(ob, base(a_end % 360.0))
        report["clips"]["FansSpinUp"] = {"seconds": round(tr, 3), "source": f"crac.FAN_DEG_S {w} °/s, FAN_SPEEDUP {up} °/s²"}
        report["clips"]["FansRun"] = {"seconds": round(period, 3), "loop": True, "source": f"one revolution at {w} °/s"}

    elif spec.family == "contain_door" and sub:
        # the two sliding leaves (contain.door_leaves): origin on the track, a pure x translation of leaf_travel
        from dc import contain
        leaves = []
        for lf in contain.door_leaves(spec):
            ob = bake_at(sub_objs(lf.model), f"Leaf_{lf.name}", Matrix.Identity(4))
            pose = lambda f, lf=lf: M0 @ T(contain.leaf_centre_x(spec, lf.side, f), 0, contain.LEAF_ORIGIN_Z)
            rest(ob, pose(0.0))
            leaves.append((ob, pose))
        n = int(round(contain.DOOR_SECONDS * FPS))
        for track, f0, f1 in (("DoorsOpen", 0.0, 1.0), ("DoorsClose", 1.0, 0.0)):
            for ob, pose in leaves:
                key_track(ob, track, [(i / FPS, pose(f0 + (f1 - f0) * i / n)) for i in range(n + 1)])
            report["clips"][track] = {"seconds": contain.DOOR_SECONDS, "nodes": [o.name for o, _ in leaves],
                                      "source": "contain.leaf_centre_x slide, linear DOOR_SECONDS"}
        for ob, pose in leaves:
            rest(ob, pose(0.0))

    try:
        from dc import names as NM
        report["display_name"], report["description"] = NM.NAMES.get(name, (None, None))
    except Exception as e:   # noqa: BLE001 (names are informational)
        report["display_name"] = None
        report["names_error"] = str(e)
    report.update(family=spec.family, cells=list(spec.cells), variant=spec.variant, density=spec.density)

    export_scene(scene, os.path.join(OUT, f"{name}.glb"))
    if VARIANTS:
        export_variants(name, spec, built, M0, report)
    report["unknown_materials"] = sorted(set(report["unknown_materials"]))
    with open(os.path.join(OUT, f"{name}.report.json"), "w") as f:
        json.dump(report, f, indent=1)
    print(f"EXPORTED {name}: nodes={list(report['nodes'])} clips={list(report['clips'])} kit={len(report['kit_replaced'])} "
          f"glyphs={report['glyphs_remapped']} stickers={report['stickers_redrawn']} dropped={report['decals_dropped']} unknown={report['unknown_materials']}")
    if report["unknown_materials"]:
        raise SystemExit(f"unknown material slots: {report['unknown_materials']}")


def tag_kit_parts():
    """Wrap se2model's part_to_object (in this process only) so every object made from a KitPart (a reused Keen
    mesh) carries WEB_KIT=1; strip_kit() then removes it whatever it is called. Installed before build_dc's own
    bevel guard, which wraps whatever part_to_object is current."""
    from se2model import objects as OB
    orig = OB.part_to_object

    def tagged(p, coll, name, *a, **k):
        ob = orig(p, coll, name, *a, **k)
        if getattr(p, "kit_meshes", None):
            ob["WEB_KIT"] = 1
        return ob
    OB.part_to_object = tagged


def main():
    os.makedirs(OUT, exist_ok=True)
    tag_kit_parts()
    import build_dc
    build_dc._install_bevel_guard()
    if VARIANTS:
        install_capture()
    if "--keep-going" not in ARGS:      # the hero export: the first failure stops the run (as before)
        for name in BLOCKS:
            export_block(name)
        return
    import traceback
    for name in BLOCKS:                 # the --all run: record a failure and go on with the next block
        try:
            export_block(name)
        except BaseException as e:      # noqa: BLE001 (SystemExit from an unknown slot included)
            if isinstance(e, KeyboardInterrupt):
                raise
            traceback.print_exc()
            with open(os.path.join(OUT, f"{name}.error.json"), "w") as f:
                json.dump({"block": name, "error": repr(e), "trace": traceback.format_exc()}, f, indent=1)
            print(f"FAILED {name}: {e!r}")


main()
