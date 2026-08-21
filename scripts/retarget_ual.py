# Ретаргет Universal Animation Library на наш риг Rig_Medium (хедлесс-Blender).
#
# Запуск:
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/retarget_ual.py
#
# Выход: assets/quaternius-ual/gltf/Rig_Medium_UAL.glb — те же 42 клипа
# + A_TPose, но дорожки лежат на костях Rig_Medium и ложатся на всех
# наших персонажей по именам, как клипы KayKit. Внутри файла — скелет
# и меш варвара: скин нужен обмеру (npm run ual), а меш — глазам.
#
# Метод — перенос дельт вращений, а не копия углов: оба рига стоят
# в T-позе (обмерено probe-скриптом: руки по +X, ноги вниз), поэтому
# для каждой пары костей берётся поворот источника ОТНОСИТЕЛЬНО его
# рест-позы в мировых осях и прикладывается к рест-позе цели:
#
#   R_цели = (R_источника @ R_реста_источника^-1) @ R_реста_цели
#
# Так различия ориентаций самих костей (roll, направление стопы) не
# переезжают в анимацию: цель сохраняет свою рест-позу и получает
# только движение. Пропорции не масштабируются — позиции в игре и так
# держит FK от таза; сам таз переносится сдвигом от реста, умноженным
# на отношение высот тазов (иначе присед 65-костного рига ростом 1,83
# вдавил бы нашего героя в пол).
#
# Карта костей — руками, и это не времянка: 65 костей сворачиваются
# в 17, пальцы уезжают в кисть, три позвонка — в два, ключицы и шея
# схлопываются. Автоматике здесь решать нечего — совпадающих имён
# один root (npm run ual).
import bpy
from mathutils import Matrix, Quaternion
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / 'assets' / 'quaternius-ual' / 'gltf'
SOURCE = PACK / 'UAL1_Standard.glb'
TARGET = ROOT / 'assets' / 'kaykit-adventurers' / 'characters' / 'Barbarian.glb'
OUT = PACK / 'Rig_Medium_UAL.glb'

FPS = 30

# цель ← источник; hand/handslot цели едут за wrist, root не трогается.
MAP = {
    'hips': 'pelvis',
    'spine': 'spine_01',
    'chest': 'spine_03',
    'head': 'Head',
    'upperarm.l': 'upperarm_l', 'lowerarm.l': 'lowerarm_l', 'wrist.l': 'hand_l',
    'upperarm.r': 'upperarm_r', 'lowerarm.r': 'lowerarm_r', 'wrist.r': 'hand_r',
    'upperleg.l': 'thigh_l', 'lowerleg.l': 'calf_l', 'foot.l': 'foot_l', 'toes.l': 'ball_l',
    'upperleg.r': 'thigh_r', 'lowerleg.r': 'calf_r', 'foot.r': 'foot_r', 'toes.r': 'ball_r',
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = FPS

bpy.ops.import_scene.gltf(filepath=str(SOURCE))
src = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
src_actions = list(bpy.data.actions)

bpy.ops.import_scene.gltf(filepath=str(TARGET))
tgt = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o is not src)

# Рест-повороты в пространстве арматуры (мировые матрицы обеих — единичные).
src_rest = {b.name: b.matrix_local.to_quaternion() for b in src.data.bones}
tgt_rest = {b.name: b.matrix_local.to_quaternion() for b in tgt.data.bones}

# Таз: сдвиг от реста масштабируется отношением высот тазов двух ригов.
pelvis_rest_at = src.data.bones['pelvis'].matrix_local.translation.copy()
hips_rest_local = tgt.data.bones['hips'].matrix_local
scale = hips_rest_local.translation.z / pelvis_rest_at.z

# Кости цели в порядке иерархии: базис каждой считается от позы родителя.
ordered = []
def walk(bone):
    ordered.append(bone.name)
    for child in bone.children:
        walk(child)
for bone in tgt.data.bones:
    if bone.parent is None:
        walk(bone)

tgt.animation_data_create()
baked = []

for act in src_actions:
    src.animation_data.action = act
    # Слот — новинка Blender 4.4+: без него действие не привязывается.
    if act.slots:
        src.animation_data.action_slot = act.slots[0]
    out = bpy.data.actions.new('RT_' + act.name)
    tgt.animation_data.action = out
    frame_start, frame_end = (int(round(v)) for v in act.frame_range)

    previous = {}
    for frame in range(frame_start, frame_end + 1):
        bpy.context.scene.frame_set(frame)
        # Желаемые мировые повороты и позиции цели: сперва все повороты…
        world_rot = {}
        for name in ordered:
            source = MAP.get(name)
            if source is None:
                world_rot[name] = tgt_rest[name].copy()
            else:
                current = src.pose.bones[source].matrix.to_quaternion()
                world_rot[name] = current @ src_rest[source].inverted() @ tgt_rest[name]
        # …затем FK сверху вниз: позиция головки кости следует за родителем.
        pose = {}
        for name in ordered:
            bone = tgt.data.bones[name]
            rotation = world_rot[name].to_matrix().to_4x4()
            if bone.parent is None:
                pose[name] = Matrix.Translation(bone.matrix_local.translation) @ rotation
            else:
                offset = bone.parent.matrix_local.inverted() @ bone.matrix_local
                at = pose[bone.parent.name] @ offset.translation
                pose[name] = Matrix.Translation(at) @ rotation
            if name == 'hips':
                shift = (src.pose.bones['pelvis'].matrix.translation - pelvis_rest_at) * scale
                pose[name] = Matrix.Translation(hips_rest_local.translation + shift) @ rotation
        # Базис: pose = pose(родителя) @ (rest(родителя)^-1 @ rest) @ basis.
        for name in ordered:
            bone = tgt.data.bones[name]
            pbone = tgt.pose.bones[name]
            if bone.parent is None:
                basis = bone.matrix_local.inverted() @ pose[name]
            else:
                basis = (
                    bone.matrix_local.inverted() @ bone.parent.matrix_local
                    @ pose[bone.parent.name].inverted() @ pose[name]
                )
            q = basis.to_quaternion()
            # Непрерывность знака: кватернион и его минус — один поворот,
            # но интерполяция между ними делает пируэт.
            if name in previous and previous[name].dot(q) < 0:
                q = -q
            previous[name] = q
            pbone.rotation_mode = 'QUATERNION'
            pbone.rotation_quaternion = q
            pbone.keyframe_insert('rotation_quaternion', frame=frame)
            if name == 'hips':
                pbone.location = basis.translation
                pbone.keyframe_insert('location', frame=frame)

    out.name = act.name + '_rt'
    baked.append(out)
    print('baked', act.name, frame_end - frame_start + 1, 'frames')

# Источники — прочь до переименования, иначе имена столкнутся и Blender
# допишет запечённым «.001», а обмер потеряет пары «источник — перенос».
tgt.animation_data.action = None
src.animation_data.action = None
for act in src_actions:
    bpy.data.actions.remove(act)

# Действия — в NLA: экспортёр в режиме ACTIONS берёт клипы оттуда.
for act in baked:
    act.name = act.name.removesuffix('_rt')
    track = tgt.animation_data.nla_tracks.new()
    track.name = act.name
    track.strips.new(act.name, 0, act)
    track.mute = True

# Источник целиком прочь: в файле должен остаться только наш риг.
for obj in list(bpy.data.objects):
    if obj is not tgt and obj.parent is not tgt and obj not in list(tgt.children_recursive):
        bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format='GLB',
    export_animation_mode='ACTIONS',
    export_anim_slide_to_zero=True,
)
print('written', OUT)
