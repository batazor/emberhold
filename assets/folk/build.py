# Поселенец и торговец: свои модели на риге KayKit `Rig_Medium`.
# Z вверх, лицо в -Y, левая сторона +X — как в риге набора.
#
# Габариты сняты с рыцаря набора (Knight.glb) в единицах того же рига:
#   ноги 0…0.53, туловище 0.38…1.30, руки z 0.98…1.27 до x 0.97, голова 1.22…2.28.
# Гарнизон и жильцы стоят в одном дворе: разные пропорции читались бы
# не «другой человек», а «другая игра».
#
# Формы: конечности — капсулы, голова и одежда — коробки с фаской в 2–3 шага,
# нормали сглаживаются по углу. Коробка без этого читается угловатой, а набор
# скруглён; при бюджете набора (у рыцаря ~5800 граней) экономить на этом незачем.
import bpy, bmesh, math
from mathutils import Vector, Matrix

ASSETS = "/Users/batazor/myproject/new_world/.claude/worktrees/blender-msp-access-af2288/assets/"

#: Угол, за которым ребро остаётся острым. Держит углы коробок, сглаживает фаски.
SHARP = math.radians(50)

# Слоты палитры артбука (src/render/palette.ts) — берутся только нужные.
MATERIAL = {
    'мрак': 0x0e0d0a, 'тень': 0x1a1813, 'камень': 0x3f3d34, 'скол': 0x6f6c60,
    'соль-тень': 0x8a8a7e, 'соль': 0xa6a698, 'соль-свет': 0xc6c6b6, 'иней': 0xe2e2d6,
    'земля-тень': 0x3b2016, 'земля': 0x6e3826, 'дерево-тень': 0x8f4e33, 'дерево': 0xb06b45,
    'дерево-свет': 0xcb9160, 'солома': 0xe3ba85, 'хвоя': 0x31432a, 'мох': 0x465c39,
    'трава': 0x5d7a49, 'трава-свет': 0x7fa361, 'металл-тень': 0x2b3138, 'металл': 0x474f58,
    'сталь': 0x7d8892, 'кожа': 0xdcd2b0, 'сукно-тень': 0x3c332c, 'сукно': 0x5c4f43,
    'сукно-свет': 0x847263, 'латунь': 0xdfa53c, 'краска-алая': 0xd83f35,
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def mat(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    hexv = MATERIAL[name]
    lin = [srgb_to_linear(((hexv >> s) & 255) / 255) for s in (16, 8, 0)]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*lin, 1)
    bsdf.inputs['Roughness'].default_value = 0.9
    m.diffuse_color = (*lin, 1)
    return m


class Folk:
    """Персонаж из частей: одна часть — одна кость и один слот палитры.

    Слот держится слоем на грани, кость — слоем на вершине: фаска добавляет
    и то и другое, и позиционный список после неё разъехался бы молча.
    """

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.fslot = self.bm.faces.layers.int.new('slot')
        self.vbone = self.bm.verts.layers.int.new('bone')
        self.slots, self.order = {}, []
        self.bones, self.bone_id = {}, []

    # --- служебное -------------------------------------------------------
    def _slot(self, m):
        if m not in self.slots:
            self.slots[m] = len(self.order)
            self.order.append(m)
        return self.slots[m]

    def _bone(self, b):
        if b not in self.bones:
            self.bones[b] = len(self.bone_id)
            self.bone_id.append(b)
        return self.bones[b]

    def _tag(self, faces, verts, si, bi):
        for f in faces:
            f[self.fslot] = si
        for v in verts:
            v[self.vbone] = bi
        self.bm.verts.index_update()
        self.bm.faces.index_update()

    def _bevel(self, verts, offset, segments, si, bi):
        edges = {e for v in verts for e in v.link_edges}
        ret = bmesh.ops.bevel(self.bm, geom=list(edges), offset=offset, offset_type='OFFSET',
                              segments=segments, profile=0.5, affect='EDGES', clamp_overlap=True)
        self._tag(ret['faces'], ret['verts'], si, bi)

    # --- формы -----------------------------------------------------------
    def box(self, bone, m, x, y, z, taper=None, shift=None, bevel=0.0, seg=1):
        """x/y/z — пары (min,max). taper — множитель верхней грани, shift — её сдвиг."""
        si, bi = self._slot(m), self._bone(bone)
        # Границы приводятся к порядку. Зеркальный вызов вида `(s * 0.055,
        # s * 0.165)` при s = -1 даёт минимум больше максимума, и коробка
        # собирается с обратным обходом: снаружи её faces смотрят внутрь.
        # Пересчёт нормалей такую коробку не всегда спасает — с фаской она
        # выходит самопересекающейся, — а на глаз в Блендере это не видно.
        (x0, x1), (y0, y1), (z0, z1) = sorted(x), sorted(y), sorted(z)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        tsx, tsy = taper or (1, 1)
        dx, dy = shift or (0, 0)
        top = lambda px, py: (cx + (px - cx) * tsx + dx, cy + (py - cy) * tsy + dy)
        low = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)]
        vs = [self.bm.verts.new(p) for p in low]
        vs += [self.bm.verts.new((*top(px, py), z1)) for px, py, _ in low]
        fs = [self.bm.faces.new([vs[i] for i in f]) for f in
              ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0))]
        self._tag(fs, vs, si, bi)
        if bevel:
            # Фаска не больше половины самой тонкой стороны. На борте кафтана
            # (0.035 в толщину) фаска 0.02 съедала деталь целиком: грани
            # вырождались, обход у соседей расходился, и получалась коробка,
            # у которой часть стенок смотрит внутрь. Видно это не в Блендере,
            # а только в игре — и не как дыру, а как «криво».
            thin = min(x1 - x0, y1 - y0, z1 - z0)
            self._bevel(vs, min(bevel, thin * 0.45), seg, si, bi)
        return vs

    def ball(self, bone, m, center, radii, u=10, v=6):
        """Эллипсоид: голова, глаза, кисти — всё, что должно быть круглым."""
        si, bi = self._slot(m), self._bone(bone)
        try:
            ret = bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, radius=1.0)
        except TypeError:
            ret = bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, diameter=1.0)
        vs = ret['verts']
        for vt in vs:
            vt.co = Vector((vt.co.x * radii[0] + center[0],
                            vt.co.y * radii[1] + center[1],
                            vt.co.z * radii[2] + center[2]))
        self._tag({f for vt in vs for f in vt.link_faces}, vs, si, bi)
        return vs

    def capsule(self, bone, m, p0, p1, r0, r1=None, sides=10, cap=2):
        """Конечность: цилиндр с полусферами на концах, r0 → r1 по длине."""
        si, bi = self._slot(m), self._bone(bone)
        r1 = r0 if r1 is None else r1
        p0, p1 = Vector(p0), Vector(p1)
        axis = p1 - p0
        L = axis.length
        rot = axis.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        base = Matrix.Translation(p0) @ rot

        profile = []                                  # (сдвиг по оси, радиус)
        for i in range(cap + 1):                      # нижняя полусфера
            a = (i / cap) * (math.pi / 2)
            profile.append((-r0 * math.cos(a), r0 * math.sin(a)))
        for i in range(1, cap + 1):                   # верхняя
            a = (i / cap) * (math.pi / 2)
            profile.append((L + r1 * math.sin(a), r1 * math.cos(a)))

        rings, poles, vs = [], [], []
        for axial, rad in profile:
            if rad < 1e-6:
                vt = self.bm.verts.new(base @ Vector((0, 0, axial)))
                poles.append((len(rings), vt)); rings.append(None); vs.append(vt)
                continue
            # радиус тела берётся линейно между концами цилиндра
            t = min(max(axial / L, 0.0), 1.0) if L > 1e-6 else 0.0
            k = (r0 + (r1 - r0) * t) / (r0 if axial <= 0 else r1)
            ring = []
            for j in range(sides):
                ang = 2 * math.pi * j / sides
                ring.append(self.bm.verts.new(
                    base @ Vector((rad * k * math.cos(ang), rad * k * math.sin(ang), axial))))
            rings.append(ring); vs.extend(ring)

        fs = []
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            if a is None or b is None:
                pole = next(vt for idx, vt in poles if idx == (i if a is None else i + 1))
                ring = b if a is None else a
                for j in range(sides):
                    k = (j + 1) % sides
                    tri = (pole, ring[j], ring[k]) if a is None else (pole, ring[k], ring[j])
                    fs.append(self.bm.faces.new(tri))
                continue
            for j in range(sides):
                k = (j + 1) % sides
                fs.append(self.bm.faces.new([a[j], a[k], b[k], b[j]]))
        self._tag(fs, vs, si, bi)
        return vs

    def disc(self, bone, m, cx, cy, cz, r_out, h, sides=12, r_in=None):
        """Плоский диск — поля шляпы; r_in делает из него усечённый конус."""
        si, bi = self._slot(m), self._bone(bone)
        r_top = r_out if r_in is None else r_in
        low, high = [], []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            low.append(self.bm.verts.new((cx + r_out * math.cos(a), cy + r_out * math.sin(a), cz)))
            high.append(self.bm.verts.new((cx + r_top * math.cos(a), cy + r_top * math.sin(a), cz + h)))
        fs = [self.bm.faces.new(low[::-1]), self.bm.faces.new(high)]
        for i in range(sides):
            j = (i + 1) % sides
            fs.append(self.bm.faces.new([low[i], low[j], high[j], high[i]]))
        self._tag(fs, low + high, si, bi)
        return low + high

    # --- сборка ----------------------------------------------------------
    def build(self, armature):
        me = bpy.data.meshes.new(self.name)
        # Ориентация граней. Коробки, капсулы и диски здесь собираются
        # перечислением вершин, и порядок обхода я задал так, что наружу
        # смотрела изнанка: объём по дивергенции выходил отрицательным.
        # В Блендере это не видно вовсе — вьюпорт рисует двусторонне, — а игра
        # рисует лицевую сторону и выворотку отбрасывает: на экране от модели
        # оставались дыры, сквозь которые видно её же нутро. Пересчёт по частям:
        # каждая часть — своя замкнутая оболочка, они не сварены между собой.
        bmesh.ops.recalc_face_normals(self.bm, faces=list(self.bm.faces))
        for e in self.bm.edges:                      # мягкие нормали по углу
            e.smooth = len(e.link_faces) != 2 or e.calc_face_angle(math.pi) < SHARP
        for f in self.bm.faces:
            f.smooth = True
        order = [f[self.fslot] for f in self.bm.faces]
        groups = {}
        for i, v in enumerate(self.bm.verts):
            groups.setdefault(self.bone_id[v[self.vbone]], []).append(i)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.order:
            me.materials.append(mat(m))
        for i, p in enumerate(me.polygons):
            p.material_index = order[i]
        for a in ('slot', 'bone'):
            if a in me.attributes:
                me.attributes.remove(me.attributes[a])
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        for bone, idx in groups.items():
            ob.vertex_groups.new(name=bone).add(idx, 1.0, 'REPLACE')
        ob.parent = armature
        ob.modifiers.new('Armature', 'ARMATURE').object = armature
        return ob


def head(f, skin, hair, brow=True):
    """Голова: скруглённая коробка, волосы шапкой по черепу и лицо.

    Лица нет ни у одной модели набора — не потому, что не нарисовано, а потому
    что запекание кладёт один слот палитры на треугольник, и нарисованное
    в атласе лицо схлопывается в ровную кожу. Своё лицо приходится делать
    геометрией, иначе его не будет вовсе.

    **Волосы — не головной убор.** Отдельная шапка поверх головы читалась
    плитой: коробка на коробке, и сколько её ни скругляй, она остаётся
    предметом, надетым сверху. Волосы сделаны срезом самой головы — та же
    форма, начиная со лба, — и потому сидят, а не лежат.

    Бровей нет по той же причине, по какой нет шапки: двумя короткими
    палочками над глазами они читались не бровями, а мусором на лице.
    Их работу делает чёлка — нижний край волос.
    """
    f.box('head', skin, (-0.455, 0.455), (-0.480, 0.430), (1.300, 2.280),
          taper=(1.05, 1.04), bevel=0.26, seg=3)
    # Шапка волос: с запасом шире головы. Скруглённый низ уходит внутрь
    # на радиус фаски, и там, где голова всего шире, запаса в сотую
    # не хватает — наружу выходит кожа, и читается это лысиной.
    f.box('head', hair, (-0.520, 0.520), (-0.545, 0.495), (1.930, 2.330),
          taper=(0.92, 0.93), bevel=0.09, seg=2)                                     # чёлка и темя
    f.box('head', hair, (-0.520, 0.520), (-0.100, 0.500), (1.560, 2.010),
          bevel=0.09, seg=2)                                                         # затылок
    for s_ in (1, -1):
        f.ball('head', skin, (s_ * 0.495, -0.020, 1.780), (0.062, 0.088, 0.118), u=8, v=5)   # ухо
        f.ball('head', 'мрак', (s_ * 0.185, -0.480, 1.830), (0.075, 0.058, 0.098), u=8, v=6)  # глаз
    f.ball('head', skin, (0.0, -0.500, 1.740), (0.068, 0.075, 0.082), u=8, v=5)      # нос


def torso(f, cloth, hips=True):
    """hips=False — там, где бёдра закрыты своей одеждой (подол туники).
    Две коробки на одной кости одного цвета дают не объём, а лишнее ребро:
    нижний край спрятанной торчит из-под верхней узкой губой."""
    f.box('chest', cloth, (-0.395, 0.395), (-0.300, 0.300), (0.900, 1.310), bevel=0.065, seg=2)
    f.box('spine', cloth, (-0.388, 0.388), (-0.294, 0.294), (0.600, 1.060), bevel=0.060, seg=2)
    if hips:
        f.box('hips', cloth, (-0.360, 0.360), (-0.270, 0.270), (0.380, 0.615), bevel=0.08, seg=2)


def limbs(f, sleeve, cuff, skin, trouser, boot, foot_h=0.150):
    """Руки и ноги капсулами: сегмент на кость, стык скрыт полусферами."""
    for s in (1, -1):
        side = '.l' if s == 1 else '.r'
        f.capsule('upperarm' + side, sleeve, (s * 0.205, 0.012, 1.123), (s * 0.470, 0.012, 1.123), 0.148, 0.142)
        f.capsule('lowerarm' + side, cuff, (s * 0.470, 0.012, 1.123), (s * 0.740, 0.012, 1.123), 0.142, 0.128)
        f.ball('hand' + side, skin, (s * 0.855, 0.012, 1.118), (0.135, 0.150, 0.150), u=10, v=6)
        # Нога сужается книзу: два одинаковых столбика читались обрубками,
        # потому что у голени нет ни икры, ни щиколотки.
        f.capsule('upperleg' + side, trouser, (s * 0.169, 0.000, 0.535), (s * 0.169, -0.006, 0.300),
                  0.152, 0.130)
        f.capsule('lowerleg' + side, trouser, (s * 0.169, -0.006, 0.300), (s * 0.169, 0.010, 0.170),
                  0.134, 0.106)
        # Башмак: короче и уже прежнего слэба, зато выше — плоская подошва
        # шире щиколотки вдвое читалась лыжей, а не обувью.
        f.box('foot' + side, boot, (s * 0.062, s * 0.276), (-0.275, 0.105), (0.0, foot_h),
              bevel=0.062, seg=2)


def settler():
    """Поселенец: чепец, короткая туника с поясом, мешок за спиной.

    Кепка с козырьком, стоявшая здесь раньше, читалась современной: козырёк —
    предмет не этого века. Чепец (шапочка, закрывающая темя и затылок до шеи)
    того же века, что замок, и лица не прячет — в отличие от капюшона,
    который при камере в 30° затенил бы всё, что нарисовано на лице.
    """
    f = Folk('Settler')
    head(f, 'кожа', 'дерево-тень')
    f.box('head', 'земля-тень', (-0.098, 0.098), (-0.505, -0.450), (1.556, 1.592), bevel=0.016, seg=2)  # рот
    torso(f, 'мох', hips=False)
    f.box('hips', 'мох', (-0.400, 0.400), (-0.305, 0.305), (0.445, 0.690),
          taper=(0.86, 0.88), bevel=0.075, seg=2)                                       # подол туники
    f.box('hips', 'земля-тень', (-0.392, 0.392), (-0.298, 0.298), (0.640, 0.735), bevel=0.038, seg=2)  # пояс
    f.box('hips', 'дерево-тень', (0.150, 0.300), (-0.340, -0.230), (0.480, 0.630), bevel=0.045, seg=2)  # кошель
    f.box('chest', 'солома', (-0.300, 0.300), (0.290, 0.600), (0.950, 1.330),
          taper=(0.85, 0.85), bevel=0.09, seg=2)                                        # мешок
    # Рукав длинный, а не закатанный: плечо от 0.205 до 0.395 сидит внутри
    # корпуса, наружу от него торчит восемь сотых — закатанного рукава
    # на такой длине не видно, видно голую руку от самого плеча.
    limbs(f, sleeve='мох', cuff='мох', skin='кожа', trouser='сукно-тень', boot='земля-тень',
          foot_h=0.145)
    return f


def merchant():
    """Торговец: широкополая шляпа и кафтан. Стоит на месте (§13.5), и шляпа —
    единственное, что читается сверху при камере в 30°."""
    f = Folk('Merchant')
    head(f, 'кожа', 'соль-тень')
    f.ball('head', 'соль-свет', (0.0, -0.400, 1.470), (0.265, 0.185, 0.245), u=10, v=6)   # борода
    f.ball('head', 'соль-свет', (0.0, -0.505, 1.665), (0.175, 0.075, 0.070), u=8, v=5)    # усы
    # Тулья шире головы (0.50 в полуширину) и садится ниже её темени (2.28),
    # иначе череп торчит между полями и тульёй бежевым кольцом.
    f.disc('head', 'сукно-тень', 0.0, -0.020, 2.010, 0.855, 0.075, sides=16)              # поля
    f.disc('head', 'сукно-тень', 0.0, -0.020, 2.020, 0.600, 0.440, sides=16, r_in=0.545)  # тулья
    f.disc('head', 'латунь', 0.0, -0.020, 2.045, 0.615, 0.090, sides=16)                  # лента
    torso(f, 'сукно')
    f.box('hips', 'сукно', (-0.380, 0.380), (-0.290, 0.290), (0.380, 0.650),
          taper=(0.86, 0.86), bevel=0.07, seg=2)                                          # полы
    f.box('hips', 'земля-тень', (-0.374, 0.374), (-0.284, 0.284), (0.630, 0.730), bevel=0.035, seg=2)  # пояс
    f.box('hips', 'латунь', (-0.085, 0.085), (-0.310, -0.270), (0.645, 0.718), bevel=0.018)           # пряжка
    for s in (1, -1):                                                                     # борта кафтана
        f.box('chest', 'сукно-свет', (s * 0.055, s * 0.170), (-0.320, -0.285), (0.980, 1.300), bevel=0.02)
    for z_ in (1.045, 1.155, 1.265):
        f.ball('chest', 'латунь', (0.108, -0.305, z_), (0.030, 0.028, 0.030), u=6, v=4)
    f.box('chest', 'дерево-тень', (-0.170, 0.030), (-0.330, -0.295), (0.980, 1.300),
          shift=(0.290, 0), bevel=0.02)                                                   # ремень
    f.box('hips', 'дерево', (-0.630, -0.360), (-0.165, 0.165), (0.540, 0.870), bevel=0.06, seg=2)  # сумка
    f.ball('hips', 'латунь', (0.430, -0.020, 0.600), (0.075, 0.070, 0.090), u=8, v=5)     # кошель
    limbs(f, sleeve='сукно', cuff='сукно', skin='кожа', trouser='сукно-тень', boot='земля-тень')
    for s in (1, -1):                                                                     # голенища
        f.capsule('lowerleg' + ('.l' if s == 1 else '.r'), 'земля-тень',
                  (s * 0.169, -0.006, 0.300), (s * 0.169, 0.010, 0.170), 0.122)
    return f


def blacksmith():
    """Кузнец: чёрные волосы и борода, кожаный фартук, закатанные рукава,
    молот в правом кулаке.

    Молот — часть модели, а не вложенный предмет: рукоять и головка сидят
    на кости `hand.r`, и в любом клипе общего рига молот ходит вместе
    с кистью. Отдельного узла вставки это не требует и не заводит.

    Рукава закатаны, и здесь это видно, в отличие от поселенца: предплечье
    целиком голое (`cuff='кожа'`), а не восемь сотых от плеча.
    """
    f = Folk('Blacksmith')
    head(f, 'кожа', 'мрак')
    f.ball('head', 'мрак', (0.0, -0.400, 1.470), (0.265, 0.185, 0.245), u=10, v=6)   # борода
    f.box('head', 'земля-тень', (-0.098, 0.098), (-0.505, -0.450), (1.556, 1.592), bevel=0.016, seg=2)  # рот
    torso(f, 'сукно-тень')
    # Фартук: кожаный, спереди, от груди до колен — то, чем кузнец отличается
    # от любого другого силуэта двора. Нагрудник уже полы: лямки на плечах
    # рисовать не из чего, а узкий верх читается фартуком и без них.
    f.box('chest', 'земля-тень', (-0.205, 0.205), (-0.335, -0.285), (1.020, 1.310), bevel=0.03, seg=2)
    f.box('spine', 'земля-тень', (-0.310, 0.310), (-0.330, -0.280), (0.620, 1.060), bevel=0.03, seg=2)
    f.box('hips', 'земля-тень', (-0.315, 0.315), (-0.310, -0.260), (0.430, 0.660),
          taper=(0.94, 1.0), bevel=0.04, seg=2)                                       # полы фартука
    f.box('hips', 'мрак', (-0.365, 0.365), (-0.285, 0.285), (0.630, 0.720), bevel=0.03, seg=2)  # пояс
    limbs(f, sleeve='сукно-тень', cuff='кожа', skin='кожа', trouser='сукно-тень', boot='земля-тень')
    # Молот в правом кулаке: рукоять сквозь кисть, головка над ней.
    f.box('hand.r', 'дерево', (-0.895, -0.815), (-0.028, 0.052), (0.640, 1.330), bevel=0.03, seg=2)
    f.box('hand.r', 'металл', (-0.960, -0.750), (-0.300, 0.220), (1.240, 1.450),
          bevel=0.05, seg=2)
    return f


def hunter():
    """Охотник: зелёная шапка с пером, алая куртка, нож остриём вниз.

    Нож — на кости `hand.r`, тем же решением, что молот кузнеца: предмет
    в руке — часть модели, и клипы двигают его вместе с кистью.
    """
    f = Folk('Hunter')
    head(f, 'кожа', 'земля-тень')
    f.box('head', 'земля-тень', (-0.098, 0.098), (-0.505, -0.450), (1.556, 1.592), bevel=0.016, seg=2)  # рот
    # Шапка: хвойная, шапочкой по темени, как чепец поселенца — и перо мхом:
    # два наклонённых бокса читаются пером ровно потому, что торчат из шапки.
    f.box('head', 'хвоя', (-0.545, 0.545), (-0.570, 0.520), (1.980, 2.360),
          taper=(0.88, 0.90), bevel=0.10, seg=2)
    f.box('head', 'мох', (0.360, 0.560), (0.050, 0.130), (2.150, 2.520),
          taper=(0.55, 1.0), shift=(0.16, 0), bevel=0.03, seg=2)                       # перо
    torso(f, 'краска-алая', hips=False)
    f.box('hips', 'краска-алая', (-0.400, 0.400), (-0.305, 0.305), (0.445, 0.690),
          taper=(0.86, 0.88), bevel=0.075, seg=2)                                      # подол куртки
    f.box('hips', 'земля-тень', (-0.392, 0.392), (-0.298, 0.298), (0.640, 0.735), bevel=0.038, seg=2)  # пояс
    f.box('hips', 'дерево-тень', (-0.300, -0.150), (-0.340, -0.230), (0.480, 0.630), bevel=0.045, seg=2)  # кошель
    limbs(f, sleeve='краска-алая', cuff='краска-алая', skin='кожа', trouser='сукно-тень', boot='земля-тень')
    # Нож в правом кулаке: рукоять сквозь кисть, клинок вниз. Плоский он
    # по x — так лезвие видно с игровой камеры, смотрящей вдоль двора.
    f.box('hand.r', 'дерево-тень', (-0.890, -0.820), (-0.023, 0.047), (1.020, 1.290), bevel=0.025, seg=2)
    # Клинок прямой: taper сужает верхнюю грань бокса, а остриё внизу,
    # и на пяти сантиметрах экрана прямое лезвие от сужённого неотличимо.
    f.box('hand.r', 'сталь', (-0.872, -0.838), (-0.035, 0.059), (0.560, 1.020), bevel=0.012)
    return f


def rig_for(name, x_offset):
    """Своя копия рига под каждого: имена костей и поза покоя — набора."""
    src = bpy.data.objects.get('Rig_Medium.001') or bpy.data.objects['Rig_Medium']
    arm = src.copy()
    arm.data = src.data.copy()
    arm.name = arm.data.name = name + '_Rig'
    arm.location = (x_offset, 0, 0)
    bpy.context.scene.collection.objects.link(arm)
    return arm


def assemble():
    for ob in list(bpy.data.objects):
        if ob.name in ('Settler', 'Merchant', 'Blacksmith', 'Hunter') or ob.name.endswith('_Rig'):
            bpy.data.objects.remove(ob, do_unlink=True)
    made = []
    for folk, dx in ((settler(), 0.0), (merchant(), 2.2), (blacksmith(), 4.4), (hunter(), 6.6)):
        arm = rig_for(folk.name, dx)
        ob = folk.build(arm)
        ob.data.calc_loop_triangles()
        made.append([ob.name, len(ob.data.loop_triangles), len(ob.data.vertices),
                     len(ob.vertex_groups), len(ob.data.materials)])
    return made
