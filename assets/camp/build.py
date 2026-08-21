# Хижина: жильё, которое строят, а не растягивают.
# Z вверх, вход в -Y — как у жильцов двора (assets/folk/build.py).
#
# Габариты взяты у блокинга жилья (src/render/models.ts): палатка 2.8 в ширину
# при коньке 1.5, бревенчатый дом 2.4×2.0 при коньке 2.05. Хижина держится
# второго: рядом с палаткой она обязана читаться не «палаткой побольше»,
# а домом — стены выше человека, крыша начинается там, где у палатки конёк.
#
# Формы: коробки с фаской в 1–2 шага, брёвна — цилиндры, крыша — призма.
# Нормали сглаживаются по углу, фаска ограничена половиной самой тонкой
# стороны: обе беды жильцов (вывернутый обход, съеденная фаской грань)
# ловятся здесь тем же способом, каким закрыты там.
import bpy, bmesh, math
from mathutils import Vector, Matrix

#: Угол, за которым ребро остаётся острым.
SHARP = math.radians(50)

# Слоты палитры артбука (src/render/palette.ts) — берутся только нужные.
MATERIAL = {
    'мрак': 0x0e0d0a, 'камень': 0x3f3d34, 'скол': 0x6f6c60,
    'земля-тень': 0x3b2016, 'дерево-тень': 0x8f4e33, 'дерево': 0xb06b45,
    'дерево-свет': 0xcb9160, 'солома': 0xe3ba85,
    'металл': 0x474f58, 'сталь': 0x7d8892, 'латунь': 0xdfa53c,
    # Слот заведён под это окно: холодного стекла в палитре не было, а чёрный
    # проём читался дырой. Ревью при добавлении — §6.1.
    'стекло': 0x6f9bb5,
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


class Prop:
    """Постройка из частей: одна часть — один слот палитры.

    Костей здесь нет и не будет: дом не ходит. От `Folk` отличается только
    этим — слот держится слоем на грани, и после фаски он на месте, потому
    что фаска добавляет грани, а не переставляет их.
    """

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.fslot = self.bm.faces.layers.int.new('slot')
        self.slots, self.order = {}, []

    # --- служебное -------------------------------------------------------
    def _slot(self, m):
        if m not in self.slots:
            self.slots[m] = len(self.order)
            self.order.append(m)
        return self.slots[m]

    def _tag(self, faces, si):
        for f in faces:
            f[self.fslot] = si
        self.bm.verts.index_update()
        self.bm.faces.index_update()

    def _bevel(self, verts, offset, segments, si):
        edges = {e for v in verts for e in v.link_edges}
        ret = bmesh.ops.bevel(self.bm, geom=list(edges), offset=offset, offset_type='OFFSET',
                              segments=segments, profile=0.5, affect='EDGES', clamp_overlap=True)
        self._tag(ret['faces'], si)

    # --- формы -----------------------------------------------------------
    def box(self, m, x, y, z, taper=None, shift=None, bevel=0.0, seg=1):
        """x/y/z — пары (min,max). taper — множитель верхней грани, shift — её сдвиг."""
        si = self._slot(m)
        # Границы приводятся к порядку: зеркальный вызов при s = -1 даёт
        # минимум больше максимума, и коробка собирается обратным обходом.
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
        self._tag(fs, si)
        if bevel:
            # Фаска не больше половины самой тонкой стороны: иначе грань
            # вырождается и обход у соседей расходится молча.
            thin = min(x1 - x0, y1 - y0, z1 - z0)
            self._bevel(vs, min(bevel, thin * 0.45), seg, si)
        return vs

    def log(self, m, p0, p1, r, sides=6, caps=True):
        """Бревно: цилиндр между двумя точками. Выпуск венца, жердь, полено."""
        si = self._slot(m)
        p0, p1 = Vector(p0), Vector(p1)
        axis = p1 - p0
        L = axis.length
        base = Matrix.Translation(p0) @ axis.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        rings = []
        for at in (0.0, L):
            ring = []
            for j in range(sides):
                a = 2 * math.pi * j / sides
                ring.append(self.bm.verts.new(base @ Vector((r * math.cos(a), r * math.sin(a), at))))
            rings.append(ring)
        fs = []
        for j in range(sides):
            k = (j + 1) % sides
            fs.append(self.bm.faces.new([rings[0][j], rings[0][k], rings[1][k], rings[1][j]]))
        if caps:
            fs.append(self.bm.faces.new(rings[0][::-1]))
            fs.append(self.bm.faces.new(rings[1]))
        self._tag(fs, si)
        return rings[0] + rings[1]

    def wedge(self, m, x, y, z, ridge=0.0, eave=0.0):
        """Призма: двускатная крыша. `ridge` — сдвиг конька по X от середины,
        `eave` — на сколько скаты свисают ниже z0 по краям."""
        si = self._slot(m)
        (x0, x1), (y0, y1), (z0, z1) = sorted(x), sorted(y), sorted(z)
        cx = (x0 + x1) / 2 + ridge
        low = [self.bm.verts.new(p) for p in
               ((x0, y0, z0 - eave), (x1, y0, z0 - eave), (x1, y1, z0 - eave), (x0, y1, z0 - eave))]
        top = [self.bm.verts.new((cx, y0, z1)), self.bm.verts.new((cx, y1, z1))]
        fs = [
            self.bm.faces.new(low),                                   # низ
            self.bm.faces.new([low[0], low[1], top[0]]),              # фронтон
            self.bm.faces.new([low[3], top[1], low[2]]),              # задний фронтон
            self.bm.faces.new([low[1], low[2], top[1], top[0]]),      # скат
            self.bm.faces.new([low[0], top[0], top[1], low[3]]),      # скат
        ]
        self._tag(fs, si)
        return low + top

    def disc(self, m, cx, cy, cz, r_out, h, sides=12, r_in=None):
        """Плоский диск: площадка под постройкой."""
        si = self._slot(m)
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
        self._tag(fs, si)
        return low + high

    # --- сборка ----------------------------------------------------------
    def build(self):
        me = bpy.data.meshes.new(self.name)
        # Каждая часть — своя замкнутая оболочка, они не сварены между собой,
        # поэтому нормали пересчитываются по частям и разом.
        bmesh.ops.recalc_face_normals(self.bm, faces=list(self.bm.faces))
        for e in self.bm.edges:
            e.smooth = len(e.link_faces) != 2 or e.calc_face_angle(math.pi) < SHARP
        for f in self.bm.faces:
            f.smooth = True
        order = [f[self.fslot] for f in self.bm.faces]
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.order:
            me.materials.append(mat(m))
        for i, p in enumerate(me.polygons):
            p.material_index = order[i]
        if 'slot' in me.attributes:
            me.attributes.remove(me.attributes['slot'])
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# --- размеры ---------------------------------------------------------------
# Одно место, где меняется дом: числа рядом, а не рассыпаны по вызовам.
HW, HD = 1.22, 0.98     # полуширина и полуглубина сруба по осям брёвен
WALL = 1.62             # верх стены. Первый заход стоял на 1.30, и с камеры
                        # 45°/30° стена уходила в полосу: крыша занимала почти
                        # весь силуэт, и дом читался навесом.
RIDGE = 2.42            # конёк
EAVE = 0.20             # свес крыши ниже верха стены
OVER_X, OVER_Y = 0.13, 0.10   # вынос крыши за сруб. Был 0.20/0.16 —
                              # крыша накрывала дом щитом и съедала стену.
LOG_R = 0.115           # радиус бревна венца
COURSES = 6             # венцов в стене

#: Проёмы. Одно объявление на дом и на вставки: дверь и окно рисуются
#: в своих файлах, а встают по этим числам, поэтому разъехаться им негде.
DOOR_W, DOOR_H = 0.72, 1.24
WIN_W, WIN_H = 0.52, 0.52
DOOR_AT = (0.0, -(HD + LOG_R), 0.20)          # низ проёма, наружная плоскость
WIN_AT = (0.74, -(HD + LOG_R), 0.86)
#: Петля двери: ось, вокруг которой дверь открывается. Объявлена домом,
#: а не игрой, по той же причине, что и проём: край полотна — свойство
#: проёма, и подобранный в коде он разъедется с моделью молча.
HINGE_AT = (-(DOOR_W / 2 - 0.03), -(0.98 + 0.115), 0.20)
#: Окошко фронтона: то же стекло, вставленное мельче. Масштаб живёт в узле —
#: значит второй модели стекла не заводится, а размер объявлен там же, где
#: и место (см. `assemble`).
VENT_AT = (0.0, -(0.98 + 0.10) - 0.02, 1.62 + 0.155)
VENT_SCALE = 0.62


def hut():
    """Хижина: сруб на камнях под соломенной крышей.

    **Почему не выросшая палатка.** Ткань растягивают, дом ставят — и разница
    видна не в размере, а в том, из чего он сделан: у палатки нет ни одной
    горизонтали, у хижины горизонталь главная (венцы), и она же держит силуэт
    на пяти сантиметрах экрана.

    **Стена — настоящие брёвна, а не коробка с поясами.** Первый заход красил
    ритм поясами поверх коробки, и вблизи это читалось досками, набитыми
    на ящик. Венцы уложены курсами: чётный вдоль X, нечётный вдоль Y, каждый
    выходит за угол — так рубят на самом деле, и на камере 30° именно
    выступающие торцы говорят «сруб» раньше, чем стена успевает прочитаться.
    Между брёвнами остаются щели, и за ними стоит тёмный короб конопатки:
    без него дом просвечивает насквозь.

    **Проёмов дом не содержит.** Дверь и окно — отдельные модели, а их место
    отмечено пустышками `doorslot` и `winslot`. Игра вставляет их по матрице
    узла ровно так же, как набор персонажей вкладывает оружие в кулак (§6.1.4),
    и по той же причине: вариант — это выбор игры, а не второй файл дома.
    """
    p = Prop('Hut')

    # Подложки у дома нет. Диск утоптанной земли, стоявший здесь, повторял
    # блокинг палатки — но у палатки он и есть пол, а дом стоит на камнях.
    # В лагере под ним своя земля, и второй круг под ней читался ковриком.

    # Камни под срубом: дом стоит не на земле, и это первое, чем он от палатки
    # отличается снизу. Высоты разные — ровный ряд читался бордюром.
    p.box('камень', (-HW - 0.05, HW + 0.05), (-HD - 0.05, HD + 0.05), (0.0, 0.16), bevel=0.03)
    for i, (sx, sy, h) in enumerate(((-1, -1, 0.30), (1, -1, 0.26), (1, 1, 0.31), (-1, 1, 0.27))):
        p.box('скол', (sx * (HW - 0.10), sx * (HW + 0.20)), (sy * (HD - 0.10), sy * (HD + 0.20)),
              (0.0, h), bevel=0.03)

    # Конопатка: тёмный короб внутри венцов. Стоит на 0.02 у́же бревна,
    # поэтому в щели видно тень, а не улицу.
    p.box('земля-тень', (-HW + LOG_R - 0.02, HW - LOG_R + 0.02),
          (-HD + LOG_R - 0.02, HD - LOG_R + 0.02), (0.22, WALL), bevel=0.03)

    # Венцы. Курс вдоль X — передняя и задняя стены, вдоль Y — боковые.
    z0, step = 0.30, (WALL - 0.30) / (COURSES - 0.5)
    for k in range(COURSES):
        z = z0 + k * step
        if k % 2 == 0:
            for sy in (-1, 1):
                p.log('дерево', (-HW - 0.18, sy * HD, z), (HW + 0.18, sy * HD, z), LOG_R, sides=6)
        else:
            for sx in (-1, 1):
                p.log('дерево-тень', (sx * HW, -HD - 0.18, z), (sx * HW, HD + 0.18, z), LOG_R, sides=6)

    # Крыша — один скат. Три наката соломы, поставленные слоями, разъехались
    # тремя отдельными щитами с собственными донцами: слой у крыши читается
    # только там, где он свисает над нижним, а не там, где просто выше.
    # Толщину даёт кромка свеса в две ступени — она же держит вес крыши.
    p.wedge('солома', (-HW - OVER_X, HW + OVER_X), (-HD - OVER_Y, HD + OVER_Y), (WALL - EAVE, RIDGE))
    # Подшивка свеса — тёмная кромка: без неё солома снизу светится и крыша
    # теряет вес. Ширина ровно по скату: выступив на два сантиметра наружу,
    # она показывала сверху чёрную полосу по всему краю крыши.
    p.box('дерево-тень', (-HW - OVER_X, HW + OVER_X), (-HD - OVER_Y, HD + OVER_Y),
          (WALL - EAVE - 0.09, WALL - EAVE), bevel=0.02)
    # Охлупень — бревно, а не брусок: конёк на соломе кладут круглым.
    p.log('дерево-тень', (0, -HD - OVER_Y - 0.10, RIDGE - 0.04),
          (0, HD + OVER_Y + 0.10, RIDGE - 0.04), 0.10, sides=6)
    # Прижимные жерди поперёк скатов.
    # Жерди кладутся на плоскость ската расчётом, а не на глаз: поставленные
    # по двум придуманным точкам, они пересекали скат — у конька уходили под
    # солому, у свеса вылезали наружу шипами. Ход ската и его нормаль считаются
    # из тех же RIDGE/EAVE, что и сама крыша, поэтому жердь лежит на ней
    # при любой правке высот.
    run = HW + OVER_X                     # от конька до свеса по горизонтали
    rise = RIDGE - (WALL - EAVE)          # и по вертикали
    hyp = math.hypot(run, rise)
    nx, nz = rise / hyp, run / hyp        # нормаль ската, единичная
    R_POLE = 0.058

    def on_slope(sx, t):
        # Точка на скате в долях пути от конька (t = 0) до свеса (t = 1),
        # приподнятая на радиус жерди по нормали.
        return (sx * (run * t + nx * R_POLE), RIDGE - rise * t + nz * R_POLE)

    for sx in (-1, 1):
        for y in (-0.60, 0.0, 0.60):
            (x0, za), (x1, zb) = on_slope(sx, 0.10), on_slope(sx, 0.99)
            p.log('дерево-тень', (x0, y, za), (x1, y, zb), R_POLE, sides=5)
    # Причелины: доски по краю фронтона. Скат без них обрывается срезом соломы,
    # и фронтон читается не концом дома, а местом, где модель кончилась.
    # Тёмные и тонкие: светлыми они читались палками, положенными на крышу,
    # а не её краем.
    for sy in (-1, 1):
        for sx in (-1, 1):
            p.log('дерево-тень', (sx * 0.04, sy * (HD + OVER_Y + 0.02), RIDGE - 0.16),
                  (sx * (HW + OVER_X - 0.01), sy * (HD + OVER_Y + 0.02), WALL - EAVE - 0.02),
                  0.04, sides=4)

    # Окошко во фронтоне. Первым заходом здесь лежала доска во всю ширину —
    # и читалась вывеской над входом. Второй заход сделал дыру, и дыра честно
    # работала силуэтом, но чёрным пятном: ровно то, за что до неё выкинули
    # чёрный проём окна. Теперь это окно — то же стекло, вставленное в узел
    # `ventslot`, только меньше. Меньше его делает не вторая модель, а масштаб
    # в матрице узла: узел несёт поворот и размер, а не только точку.
    p.box('мрак', (-0.17, 0.17), (-HD - OVER_Y - 0.04, -HD - OVER_Y + 0.06),
          (WALL + 0.14, WALL + 0.44), bevel=0.02)
    for sx in (-1, 1):
        p.box('дерево-свет', (sx * 0.17, sx * 0.25), (-HD - OVER_Y - 0.05, -HD - OVER_Y + 0.02),
              (WALL + 0.10, WALL + 0.48), bevel=0.02)
    p.box('дерево-свет', (-0.25, 0.25), (-HD - OVER_Y - 0.05, -HD - OVER_Y + 0.02),
          (WALL + 0.44, WALL + 0.50), bevel=0.02)

    # Проёмы: тёмная ниша, в которую встаёт вставка. Ниша принадлежит дому,
    # потому что дыра в стене — свойство стены, а не двери.
    p.box('мрак', (-DOOR_W / 2, DOOR_W / 2), (-HD - LOG_R + 0.02, -HD + LOG_R),
          (0.20, 0.20 + DOOR_H), bevel=0.02)
    p.box('мрак', (WIN_AT[0] - WIN_W / 2, WIN_AT[0] + WIN_W / 2),
          (-HD - LOG_R + 0.02, -HD + LOG_R), (WIN_AT[2], WIN_AT[2] + WIN_H), bevel=0.02)

    # Крыльцо: порог-плита и навес на двух столбах. Вход без навеса на камере
    # 30° теряется в тени свеса — а вход обязан быть виден первым.
    p.box('скол', (-0.46, 0.46), (-HD - 0.52, -HD - 0.06), (0.0, 0.12), bevel=0.03)
    for sx in (-1, 1):
        p.log('дерево-тень', (sx * 0.42, -HD - 0.40, 0.10), (sx * 0.42, -HD - 0.40, 1.46), 0.06, sides=5)
    # Навес — сужающаяся кверху коробка, а не призма: конёк призмы идёт вдоль Y,
    # то есть от стены наружу, и над дверью он смотрелся бы вторым домиком,
    # поставленным поперёк.
    p.box('солома', (-0.62, 0.62), (-HD - 0.56, -HD + 0.02), (1.40, 1.62),
          taper=(0.62, 0.42), shift=(0, 0.14), bevel=0.02)
    p.box('дерево-тень', (-0.64, 0.64), (-HD - 0.58, -HD + 0.02), (1.34, 1.40), bevel=0.02)

    # Поленница у боковой стены. Шаг равен диаметру полена: с зазором
    # в полрадиуса она рассыпалась на отдельные палки, лежащие рядом.
    for row, z in enumerate((0.34, 0.49)):
        for i in range(3 - row):
            y = -0.36 + i * 0.17 + row * 0.085
            p.log('дерево' if (i + row) % 2 else 'дерево-тень',
                  (HW + 0.14, y, z), (HW + 0.58, y, z), 0.085, sides=5)

    return p


def door_plank():
    """Дверь дощатая: пять досок на двух шпонках. Дешёвый вариант."""
    p = Prop('Door_Plank')
    w, h = DOOR_W - 0.06, DOOR_H - 0.06
    n = 5
    for i in range(n):
        x0 = -w / 2 + i * (w / n)
        p.box('дерево' if i % 2 else 'дерево-свет', (x0 + 0.008, x0 + w / n - 0.008),
              (-0.07, 0.0), (0.0, h), bevel=0.012)
    for z in (h * 0.24, h * 0.76):                       # шпонки
        p.box('дерево-тень', (-w / 2, w / 2), (-0.10, -0.06), (z, z + 0.09), bevel=0.02)
    p.log('латунь', (w * 0.30, -0.13, h * 0.48), (w * 0.30, -0.06, h * 0.48), 0.035, sides=6)
    return p


def door_studded():
    """Дверь обитая: полотно, полосы железа и заклёпки. Дорогой вариант —
    тот же проём, другая цена, и это видно без цифры."""
    p = Prop('Door_Studded')
    w, h = DOOR_W - 0.06, DOOR_H - 0.06
    p.box('дерево-тень', (-w / 2, w / 2), (-0.07, 0.0), (0.0, h), bevel=0.02)
    for z in (h * 0.18, h * 0.5, h * 0.82):              # полосы
        p.box('сталь', (-w / 2 - 0.012, w / 2 + 0.012), (-0.10, -0.05), (z, z + 0.075), bevel=0.018)
        for sx in (-1, 1):                               # заклёпки
            p.log('сталь', (sx * w * 0.34, -0.115, z + 0.037), (sx * w * 0.34, -0.09, z + 0.037),
                  0.028, sides=5)
    for z in (h * 0.18, h * 0.82):                       # петли
        p.box('металл', (-w / 2 - 0.03, -w / 2 + 0.14), (-0.11, -0.06), (z - 0.02, z + 0.095), bevel=0.015)
    p.log('латунь', (w * 0.30, -0.14, h * 0.5), (w * 0.30, -0.06, h * 0.5), 0.04, sides=6)
    return p


def window_cross():
    """Окно с крестовиной: рама и переплёт крестом."""
    p = Prop('Window_Cross')
    w, h = WIN_W, WIN_H
    for sx in (-1, 1):                                   # стойки рамы
        p.box('дерево-свет', (sx * w / 2, sx * (w / 2 - 0.075)), (-0.075, 0.0), (0.0, h), bevel=0.018)
    for z in (0.0, h - 0.075):                           # верх и низ рамы
        p.box('дерево-свет', (-w / 2, w / 2), (-0.075, 0.0), (z, z + 0.075), bevel=0.018)
    p.box('дерево-свет', (-0.028, 0.028), (-0.055, -0.005), (0.06, h - 0.06), bevel=0.012)
    p.box('дерево-свет', (-w / 2 + 0.06, w / 2 - 0.06), (-0.055, -0.005),
          (h / 2 - 0.028, h / 2 + 0.028), bevel=0.012)
    return p


def window_shutter():
    """Окно со ставнями: та же рама, но с двумя откинутыми створками."""
    p = Prop('Window_Shutter')
    w, h = WIN_W, WIN_H
    for sx in (-1, 1):
        p.box('дерево-свет', (sx * w / 2, sx * (w / 2 - 0.075)), (-0.075, 0.0), (0.0, h), bevel=0.018)
    for z in (0.0, h - 0.075):
        p.box('дерево-свет', (-w / 2, w / 2), (-0.075, 0.0), (z, z + 0.075), bevel=0.018)
    # Створки стоят под углом к стене: плоские, они сливались бы с рамой
    # в одну доску. Угол даёт им собственную грань и собственную тень.
    for sx in (-1, 1):
        p.box('дерево', (sx * (w / 2 + 0.02), sx * (w / 2 + 0.30)), (-0.15, -0.09),
              (0.02, h - 0.02), taper=(1.0, 1.0), bevel=0.015)
        p.box('дерево-тень', (sx * (w / 2 + 0.05), sx * (w / 2 + 0.27)), (-0.175, -0.145),
              (h * 0.30, h * 0.44), bevel=0.012)
    return p


def glass():
    """Стекло: отдельная модель на тот же узел, что и окно.

    Отдельная она не ради порядка, а ради двух вещей сразу. Первая — цвет:
    чёрный проём читался дырой в стене, а окно в жилье обязано читаться
    стеклом, и слот `стекло` в палитре холодный. Вторая — ночь: светится
    в доме окно, а не дом, и материал у светящейся части обязан быть свой.
    Обе решаются одним куском геометрии, и потому он один.
    """
    p = Prop('Glass')
    p.box('стекло', (-WIN_W / 2 + 0.07, WIN_W / 2 - 0.07), (-0.045, -0.02),
          (0.07, WIN_H - 0.07), bevel=0.01)
    return p


PARTS = (hut, door_plank, door_studded, window_cross, window_shutter, glass)


def empty(name, at):
    """Узел вставки. Пустышка, а не кость: дом не гнётся, а место двери —
    это точка и поворот, и ничего больше."""
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = 'ARROWS'
    ob.empty_display_size = 0.25
    ob.location = at
    bpy.context.scene.collection.objects.link(ob)
    return ob


def assemble():
    """Собрать дом целиком и поставить вставки по своим узлам.

    Вставки **сажаются на узлы прямо в сцене**, а не сваливаются в начало
    координат. Первым заходом они лежали в нуле, и открытая сцена показывала
    дом с чёрными нишами вместо двери и окон: сборку видела только игра,
    а Блендер — нет. Родитель-пустышка даёт то же, что матрица узла даёт игре,
    включая масштаб окошка фронтона, — то есть сцена и игра собирают дом
    одинаково, и разойтись им негде.

    Экспорт при этом уносит вставку **в её собственных координатах**: на время
    записи файла родитель и трансформ снимаются. Иначе смещение узла уехало бы
    в файл и сложилось бы с матрицей ещё раз — дверь оказалась бы в двух шагах
    от проёма.
    """
    made_names = {'Hut', 'Door_Plank', 'Door_Studded', 'Window_Cross', 'Window_Shutter', 'Glass',
                  'Glass_Vent', 'doorslot', 'hingeslot', 'winslot', 'ventslot'}
    for ob in list(bpy.data.objects):
        if ob.name.split('.')[0] in made_names:
            bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.name.split('.')[0] in made_names and me.users == 0:
            bpy.data.meshes.remove(me)

    out = []
    for make in PARTS:
        ob = make().build()
        ob.data.calc_loop_triangles()
        out.append([ob.name, len(ob.data.loop_triangles), len(ob.data.vertices),
                    len(ob.data.materials)])

    # Узлы вставки живут в файле дома и едут в игру матрицами (§6.1.4):
    # где дверь, где её петля, где окно и где окошко фронтона. Матрица,
    # а не точка, потому что вставку случается и уменьшать: у фронтона тот же
    # кусок стекла стоит вшестеро мельче, и объявлено это здесь.
    hut_ob = bpy.data.objects['Hut']
    nodes = {}
    for name, at, scale in (('doorslot', DOOR_AT, 1.0), ('hingeslot', HINGE_AT, 1.0),
                            ('winslot', WIN_AT, 1.0), ('ventslot', VENT_AT, VENT_SCALE)):
        node = empty(name, at)
        node.scale = (scale, scale, scale)
        node.parent = hut_ob
        nodes[name] = node

    # Второе стекло — копия того же меша: во фронтоне стоит та же модель.
    vent_glass = bpy.data.objects['Glass'].copy()
    vent_glass.data = bpy.data.objects['Glass'].data
    vent_glass.name = 'Glass_Vent'
    bpy.context.scene.collection.objects.link(vent_glass)

    # Что на каком узле висит в сцене. Дверь берётся дощатая, окно — с крестом:
    # сцена показывает один вид дома, а не все четыре сразу.
    for part, node in (('Door_Plank', 'doorslot'), ('Window_Cross', 'winslot'),
                       ('Glass', 'winslot'), ('Glass_Vent', 'ventslot')):
        ob = bpy.data.objects[part]
        ob.parent = nodes[node]
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.location = (0, 0, 0)
    # Варианты, которых в кадре нет, стоят рядом, а не внутри дома.
    for i, part in enumerate(('Door_Studded', 'Window_Shutter')):
        bpy.data.objects[part].location = (2.6 + i * 0.9, -1.6, 0.0)
    return out


def export_part(root, name, out):
    """Записать модель в её собственных координатах.

    Родитель и трансформ снимаются на время записи: в файл обязано уехать то,
    что нарисовано скриптом, а место вставки — дело матрицы узла, и записать
    его дважды значит поставить дверь в двух шагах от проёма.
    """
    ob = bpy.data.objects[name]
    keep = (ob.parent, ob.matrix_parent_inverse.copy(), ob.location.copy(),
            ob.rotation_euler.copy(), ob.scale.copy())
    ob.parent = None
    ob.location = (0, 0, 0)
    ob.rotation_euler = (0, 0, 0)
    ob.scale = (1, 1, 1)
    bpy.ops.object.select_all(action='DESELECT')
    ob.hide_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    extra = []
    if name == 'Hut':
        for node in ('doorslot', 'hingeslot', 'winslot', 'ventslot'):
            n = bpy.data.objects[node]
            n.hide_set(False)
            n.select_set(True)
            extra.append(n)
    bpy.ops.export_scene.gltf(
        filepath=root + 'assets/camp/' + out, export_format='GLB', use_selection=True,
        export_apply=True, export_materials='EXPORT', export_yup=True, export_normals=True,
        export_texcoords=False, export_skins=False, export_animations=False,
        export_extras=False, export_cameras=False, export_lights=False)
    ob.parent, ob.matrix_parent_inverse, ob.location, ob.rotation_euler, ob.scale = keep
