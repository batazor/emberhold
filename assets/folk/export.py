# Хедлесс-драйвер к `build.py`: собирает жильца и пишет его `.glb` рядом.
#
# Запуск (Blender 4+):
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P assets/folk/export.py -- Forester
#
# Без имени пересобираются все. Имя — то же, что у функции сборки
# (`forester` → `Forester.glb`), и оно же имя объекта в сцене.
#
# **Риг берётся из уже собранного жильца, а не из набора.** `Settler.glb`
# лежит рядом, в нём тот же `Rig_Medium` с теми же двадцатью тремя костями
# в той же позе привязки, — а файла набора в репозитории может не оказаться
# вовсе. Так драйвер не зависит ни от чего, кроме папки, в которой лежит.
#
# Позиция рига обнуляется перед записью. В сборке жильцы разведены по x,
# чтобы не стоять друг в друге, и невынутый сдвиг уехал бы в файл: модель
# оказалась бы смещённой относительно собственного начала координат,
# а запекание (`npm run models`) мерит габарит именно от него.
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))

# Кого умеет собрать драйвер: имя объекта → имя функции в `build.py`.
FOLK = {
    'Settler': 'settler',
    'Settler_Female': 'settler_female',
    'Merchant': 'merchant',
    'Blacksmith': 'blacksmith',
    'Hunter': 'hunter',
    'Forester': 'forester',
}


def load_build():
    """`build.py` исполняется как есть: второй копии его функций быть не должно."""
    ns = {'__file__': os.path.join(HERE, 'build.py'), '__name__': 'build'}
    with open(ns['__file__'], encoding='utf-8') as fh:
        exec(compile(fh.read(), ns['__file__'], 'exec'), ns)
    return ns


def rig():
    """Скелет из `Settler.glb`: тот же `Rig_Medium`, что у всех жильцов."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, 'Settler.glb'))
    arm = next(ob for ob in bpy.data.objects if ob.type == 'ARMATURE')
    arm.name = arm.data.name = 'Rig_Medium'
    # Меш поселенца больше не нужен: нужен был скелет, который он носит.
    for ob in list(bpy.data.objects):
        if ob.type == 'MESH':
            bpy.data.objects.remove(ob, do_unlink=True)
    return arm


def export(name, ns):
    arm = rig()
    folk = ns[FOLK[name]]()
    dup = ns['rig_for'](folk.name, 0.0)
    dup.location = (0.0, 0.0, 0.0)
    ob = folk.build(dup)
    bpy.data.objects.remove(arm, do_unlink=True)

    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    dup.select_set(True)
    bpy.context.view_layer.objects.active = dup
    out = os.path.join(HERE, name + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_skins=True,
        export_animations=False,
        # Материал здесь — имя слота палитры и ничего больше: запекание
        # читает его словом (`scripts/models.ts`, набор `folk`), картинок
        # у своих моделей нет вовсе.
        export_materials='EXPORT',
        export_yup=True,
    )
    ob.data.calc_loop_triangles()
    print(f'{name}: {len(ob.data.loop_triangles)} треугольников, '
          f'{len(ob.data.vertices)} вершин, {len(ob.data.materials)} материалов → {out}')


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = args or list(FOLK)
    ns = load_build()
    for name in names:
        if name not in FOLK:
            raise SystemExit(f'неизвестный жилец: {name}; известны {", ".join(FOLK)}')
        export(name, ns)


main()
