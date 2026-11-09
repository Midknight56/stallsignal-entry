"""Build the Portland map from local Census archives. No network access is used.

Preferred reader: pyshp. A small standard library reader for the exact 2D TIGER
formats used here also permits builds where the Python user site is unavailable.
"""

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import struct
import zipfile
from collections import defaultdict
from html import escape

try:
    import shapefile
except ModuleNotFoundError:
    shapefile = None

WIDTH, HEIGHT, RADIUS = 1000, 700, 22
LON, LAT = -70.2620, 43.6580
EARTH_RADIUS = 6371008.8
LAT_SPAN = math.degrees(2520 / EARTH_RADIUS)
LON_SPAN = math.degrees(3600 / (EARTH_RADIUS * math.cos(math.radians(LAT))))
FRAME = dict(west=LON - LON_SPAN / 2, south=LAT - LAT_SPAN / 2,
             east=LON + LON_SPAN / 2, north=LAT + LAT_SPAN / 2)


def records(path, geometry=True):
    """Yield (DBF fields, geometry parts), reading members without extraction."""
    with zipfile.ZipFile(path) as archive:
        members = {Path(n).suffix.lower(): n for n in archive.namelist()}
        dbf = archive.read(members['.dbf'])
        if shapefile is not None:
            args = {'dbf': io.BytesIO(dbf)}
            if geometry:
                args.update({ext: io.BytesIO(archive.read(members['.' + ext]))
                             for ext in ('shp', 'shx')})
            with shapefile.Reader(**args) as reader:
                if not geometry:
                    for record in reader.iterRecords():
                        yield record.as_dict(), []
                else:
                    for item in reader.iterShapeRecords():
                        points = item.shape.points
                        ends = list(item.shape.parts) + [len(points)]
                        yield item.record.as_dict(), [list(points[a:b]) for a, b in zip(ends, ends[1:])]
            return
        # DBF III and little endian Polygon/PolyLine are the only formats needed.
        count, header, size = struct.unpack_from('<IHH', dbf, 4)
        fields = []
        for offset in range(32, header - 1, 32):
            if dbf[offset] == 13:
                break
            fields.append((dbf[offset:offset + 11].split(b'\0')[0].decode('ascii'), dbf[offset + 16]))
        shp = archive.read(members['.shp']) if geometry else b''
        shape_offset = 100
        for index in range(count):
            row = dbf[header + index * size:header + (index + 1) * size]
            parts = []
            if geometry:
                length = struct.unpack_from('>i', shp, shape_offset + 4)[0] * 2
                start = shape_offset + 8
                shape_type = struct.unpack_from('<i', shp, start)[0]
                if shape_type not in (0, 3, 5):
                    raise ValueError(f'Unsupported TIGER shape type: {shape_type}')
                if shape_type:
                    part_count, point_count = struct.unpack_from('<ii', shp, start + 36)
                    indices = list(struct.unpack_from(f'<{part_count}i', shp, start + 44)) + [point_count]
                    points = list(struct.iter_unpack('<dd', shp[start + 44 + 4 * part_count:start + length]))
                    parts = [points[a:b] for a, b in zip(indices, indices[1:])]
                shape_offset = start + length
            if row[0:1] == b'*':
                continue
            record, cursor = {}, 1
            for name, width in fields:
                record[name] = row[cursor:cursor + width].decode('utf-8').strip()
                cursor += width
            yield record, parts


def project(point):
    lon, lat = point
    return ((lon - FRAME['west']) / LON_SPAN * WIDTH,
            (FRAME['north'] - lat) / LAT_SPAN * HEIGHT)


def distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def segment_distance(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) if dx or dy else 0
    return distance(p, (a[0] + t * dx, a[1] + t * dy))


def simplify(points, tolerance=1.2):
    if len(points) < 3:
        return points
    distances = [segment_distance(p, points[0], points[-1]) for p in points[1:-1]]
    maximum = max(distances, default=0)
    if maximum <= tolerance:
        return [points[0], points[-1]]
    index = distances.index(maximum) + 1
    return simplify(points[:index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def rounded(points):
    result = []
    for x, y in points:
        point = [round(max(0, min(WIDTH, x)), 1), round(max(0, min(HEIGHT, y)), 1)]
        if not result or result[-1] != point:
            result.append(point)
    return result


def area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1])) / 2


def clip_ring(points):
    points = points[:-1] if points[0] == points[-1] else points
    for axis, boundary, direction in ((0, 0, 1), (0, WIDTH, -1), (1, 0, 1), (1, HEIGHT, -1)):
        output = []
        for a, b in zip(points, points[1:] + points[:1]):
            inside_a = (a[axis] - boundary) * direction >= 0
            inside_b = (b[axis] - boundary) * direction >= 0
            if inside_a != inside_b:
                t = (boundary - a[axis]) / (b[axis] - a[axis])
                output.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
            if inside_b:
                output.append(b)
        points = output
        if not points:
            return []
    # Split a closed ring at a distant vertex before simplifying both arcs.
    pivot = max(range(len(points)), key=lambda i: distance(points[0], points[i]))
    points = simplify(points[:pivot + 1])[:-1] + simplify(points[pivot:] + [points[0]])
    points = rounded(points)
    if len(points) < 4 or abs(area(points)) < 0.5:
        return []
    return points


def clip_line(points):
    pieces, current = [], []
    for a, b in zip(points, points[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        low, high, valid = 0, 1, True
        for p, q in ((-dx, a[0]), (dx, WIDTH - a[0]), (-dy, a[1]), (dy, HEIGHT - a[1])):
            if p == 0:
                if q < 0:
                    valid = False
                    break
            elif p < 0:
                low = max(low, q / p)
            else:
                high = min(high, q / p)
        if not valid or low > high:
            if current:
                pieces.append(current)
                current = []
            continue
        start, end = (a[0] + low * dx, a[1] + low * dy), (a[0] + high * dx, a[1] + high * dy)
        if current and distance(current[-1], start) > 1e-7:
            pieces.append(current)
            current = []
        if not current:
            current.append(start)
        current.append(end)
    if current:
        pieces.append(current)
    return [rounded(simplify(piece)) for piece in pieces]


def inside(point, ring):
    x, y = point
    result = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if segment_distance(point, a, b) < 1e-7:
            return True
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            result = not result
    return result


def length(points):
    return sum(distance(a, b) for a, b in zip(points, points[1:]))


def along(points, fraction):
    remaining = length(points) * fraction
    for a, b in zip(points, points[1:]):
        size = distance(a, b)
        if remaining <= size and size:
            t = remaining / size
            angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
            angle = (angle + 90) % 180 - 90
            return a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), angle
        remaining -= size
    return *points[-1], 0


def axial(point):
    x, y = point
    q = 2 * x / (3 * RADIUS)
    r = (-x / 3 + math.sqrt(3) * y / 3) / RADIUS
    s = -q - r
    iq, ir, iz = round(q), round(r), round(s)
    errors = abs(iq - q), abs(ir - r), abs(iz - s)
    if errors[0] >= max(errors[1:]):
        iq = -ir - iz
    elif errors[1] >= errors[2]:
        ir = -iq - iz
    return iq, ir


def hex_center(q, r):
    return round(1.5 * RADIUS * q, 1), round(math.sqrt(3) * RADIUS * (r + q / 2), 1)


def corners(x, y):
    return [(x + RADIUS * math.cos(i * math.pi / 3), y + RADIUS * math.sin(i * math.pi / 3)) for i in range(6)]


def label_box(label):
    # Match the map's 12px text, including rotation, baseline and halo.
    width = len(label['text']) * 6.5 + 6
    angle = math.radians(label['angle'])
    anchor = 'start' if label['x'] < 80 else 'end' if label['x'] > 920 else 'middle'
    left = 0 if anchor == 'start' else -width if anchor == 'end' else -width / 2
    points = [(label['x'] + x * math.cos(angle) - y * math.sin(angle),
               label['y'] + x * math.sin(angle) + y * math.cos(angle))
              for x, y in ((left, -15), (left + width, -15), (left, 5), (left + width, 5))]
    return min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)


def overlaps(a, b):
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]


def build(raw):
    print('Reader:', 'pyshp ' + shapefile.__version__ if shapefile else 'standard library TIGER reader (pyshp unavailable)')
    print('Frame bounds:', json.dumps(FRAME, sort_keys=True))
    tiger = raw / 'tiger'
    water, roads = [], []
    full_names = {'Fore Riv': 'Fore River', 'Back Cv': 'Back Cove', 'Atlantic Ocn': 'Atlantic Ocean'}
    for record, parts in records(tiger / 'tl_2025_23005_areawater.zip'):
        rings = [ring for part in parts if (ring := clip_ring([project(p) for p in part]))]
        if rings:
            name = record['FULLNAME'] or ''
            water.append(dict(name=full_names.get(name, name), rings=rings))
    water.sort(key=lambda f: (f['name'], f['rings']))
    rings = [ring for feature in water for ring in feature['rings']]
    wet = lambda p: any(inside(p, ring) for ring in rings)
    for record, parts in records(tiger / 'tl_2025_23005_roads.zip'):
        code = record['MTFCC']
        if code not in ('S1100', 'S1200', 'S1400'):
            continue
        kind = 'local' if code == 'S1400' else 'major'
        for part in parts:
            for points in clip_line([project(p) for p in part]):
                if len(points) >= 2 and length(points) >= (15 if kind == 'local' else 0.1):
                    roads.append(dict(name=record['FULLNAME'] or '', **{'class': kind}, points=points))
    roads.sort(key=lambda road: (road['name'], road['class'], road['points']))

    jobs = {}
    with gzip.open(raw / 'lodes' / 'me_wac_S000_JT00_2024.csv.gz', 'rt', newline='') as source:
        for row in csv.DictReader(source):
            jobs[row['w_geocode']] = int(row['C000'])
    bins = defaultdict(int)
    for row, _ in records(tiger / 'tl_2025_23_tabblock20.zip', geometry=False):
        point = project((float(row['INTPTLON20']), float(row['INTPTLAT20'])))
        if 0 <= point[0] <= WIDTH and 0 <= point[1] <= HEIGHT:
            bins[axial(point)] += jobs.get(row['GEOID20'], 0)
    cells = {}
    for q in range(32):
        for r in range(-16, 20):
            x, y = hex_center(q, r)
            checks = [(x, y)] + corners(x, y)
            if all(0 <= p[0] <= WIDTH and 0 <= p[1] <= HEIGHT and not wet(p) for p in checks):
                cells[q, r] = dict(x=x, y=y, radius=RADIUS, jobs=bins[q, r])
    maximum = max(cell['jobs'] for cell in cells.values())
    for cell in cells.values():
        cell['interest'] = round(math.log1p(cell['jobs']) / math.log1p(maximum), 3) if maximum else 0
    heat = sorted(cells.values(), key=lambda c: (c['x'], c['y']))

    # Road samples must belong to a retained heat cell and clear all shorelines.
    candidates = []
    for road in roads:
        if not road['name']:
            continue
        steps = max(1, math.ceil(length(road['points']) / 3))
        for i in range(steps + 1):
            x, y, _ = along(road['points'], i / steps)
            point = round(x, 1), round(y, 1)
            cell = cells.get(axial(point))
            if cell is None or min(x, y, WIDTH - x, HEIGHT - y) < 25 or wet(point):
                continue
            shore = min(segment_distance(point, a, b) for ring in rings for a, b in zip(ring, ring[1:] + ring[:1]))
            if shore >= 26.5:
                candidates.append(dict(x=point[0], y=point[1], street=road['name'], kind=road['class'], jobs=cell['jobs'], interest=cell['interest'], shore=shore))
    wharves = [p for p in candidates if p['street'] == 'Commercial St']
    if not wharves:
        raise ValueError('No safe Commercial St candidate')
    wharves.sort(key=lambda p: (-p['jobs'], p['shore'], p['x'], p['y']))
    job_values = sorted(c['jobs'] for c in heat)
    low, middle, high = (job_values[int((len(job_values) - 1) * f)] for f in (0.25, 0.5, 0.75))
    selected = None
    for wharf in wharves:
        if wharf['jobs'] < high:
            break
        mills = [p for p in candidates if p['street'] == 'Atlantic St'
                 and low < p['jobs'] <= high and p['interest'] >= 0.1 * max(c['interest'] for c in heat)
                 and distance((p['x'], p['y']), (wharf['x'], wharf['y'])) >= 300]
        mills.sort(key=lambda p: (abs(p['jobs'] - middle), p['street'], p['x'], p['y']))
        for mill in mills:
            lindens = [p for p in candidates if p['street'] == 'A St' and p['kind'] == 'local' and p['jobs'] <= low
                       and all(distance((p['x'], p['y']), (other['x'], other['y'])) >= 300 for other in (wharf, mill))]
            if lindens:
                linden = min(lindens, key=lambda p: (p['jobs'], p['street'], p['x'], p['y']))
                selected = [wharf, mill, linden]
                break
        if selected:
            break
    if selected is None:
        raise ValueError('Cannot satisfy venue job tiers, separation and shoreline clearance')
    spots = [dict(id=id_, x=p['x'], y=p['y'], street=p['street']) for id_, p in zip(('wharf', 'mill', 'linden'), selected)]
    print('Venue job tiers (quartiles):', low, middle, high)
    for spot, candidate in zip(spots, selected):
        print('Venue:', spot, 'jobs:', candidate['jobs'], 'water distance:', round(candidate['shore'], 1))

    labels = []
    occupied = []
    for spot in spots:
        x, y = spot['x'], spot['y']
        # Keep labels clear of pins and current demand rings, with room for live orders.
        occupied.append((x - 60, y - 60, x + 60, y + 60))
        name = {'wharf': 'Shed 9', 'mill': 'Millrace Hall', 'linden': 'Linden Corner Shop'}[spot['id']]
        half = (len(name) * 9 + 10) / 2
        occupied.append((x - half, y - 68, x + half, y - 40))

    def accept(label):
        box = label_box(label)
        if box[0] < 4 or box[1] < 4 or box[2] > WIDTH - 4 or box[3] > HEIGHT - 4:
            return False
        if any(overlaps(box, other) for other in occupied):
            return False
        labels.append(label)
        occupied.append(box)
        return True

    named_water = defaultdict(list)
    for feature in water:
        if feature['name']:
            named_water[feature['name']].extend(feature['rings'])
    for name, body in sorted(named_water.items()):
        # A coarse interior clearance search gives readable labels in concave bays.
        options = [(x, y) for x in range(10, WIDTH, 10) for y in range(10, HEIGHT, 10)
                   if any(inside((x, y), ring) for ring in body)]
        if not options:
            options = [tuple(ring[0]) for ring in body]
        def clearance(p):
            return min(p[0], p[1], WIDTH - p[0], HEIGHT - p[1],
                       min(segment_distance(p, a, b) for ring in body for a, b in zip(ring, ring[1:] + ring[:1])))
        # Refine the coarse search and require an interior anchor, never a shore fallback.
        best = sorted(options, key=lambda p: (-clearance(p), p))[:20]
        refined = {(x + dx, y + dy) for x, y in best
                   for dx in range(-9, 10) for dy in range(-9, 10)
                   if any(inside((x + dx, y + dy), ring) for ring in body)}
        for x, y in sorted(refined, key=lambda p: (-clearance(p), p)):
            if clearance((x, y)) < 8:
                continue
            label = dict(text=name, kind='water', x=x, y=y, angle=-75 if name == 'Casco Bay' else 0)
            if accept(label):
                break
        else:
            raise ValueError(f'No legible water label for {name}')
    streets = defaultdict(list)
    for road in roads:
        if road['name'] and not road['name'].startswith(('US Hwy', 'State Rte', 'I-')):
            streets[road['name']].append(road)
    preferred = ['Congress St', 'Commercial St', 'Fore St', 'Franklin St', 'High St', 'Forest Ave', 'Washington Ave', 'State St']
    names = sorted(streets, key=lambda n: (preferred.index(n) if n in preferred else len(preferred),
                                         -sum(length(r['points']) for r in streets[n]), n))
    count = 0
    for name in names:
        placed = False
        for road in sorted(streets[name], key=lambda r: -length(r['points'])):
            if length(road['points']) < len(name) * 6.5:
                continue
            for fraction in (0.5, 0.3, 0.7, 0.15, 0.85):
                x, y, angle = along(road['points'], fraction)
                if accept(dict(text=name, kind='street', x=round(x, 1), y=round(y, 1), angle=round(angle, 1))):
                    placed = True
                    count += 1
                    break
            if placed:
                break
        if count == 8:
            break
    return dict(name='Portland, Maine', label='Real streets', viewBox='0 0 1000 700', frame=FRAME,
                water=water, roads=roads, labels=labels, heat=heat, venueSpots=spots,
                heatLabel='Daytime workers, 2024',
                sources=dict(tiger='TIGER/Line 2025', lodes='LODES 8.5, me_wac_S000_JT00_2024'), checksum='')


def compact(data):
    # Match JSON.stringify number spelling for integer valued coordinates.
    def normalize(value):
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, dict):
            return {key: normalize(item) for key, item in value.items()}
        if isinstance(value, list):
            return [normalize(item) for item in value]
        return value
    return json.dumps(normalize(data), sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def preview(data, path):
    svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700">',
           '<rect width="1000" height="700" fill="#f5f1e7"/>']
    for feature in data['water']:
        d = ' '.join('M' + ' L'.join(f'{x},{y}' for x, y in ring) + 'Z' for ring in feature['rings'])
        svg.append(f'<path d="{d}" fill="#a9d8e8" fill-rule="evenodd"/>')
    for cell in data['heat']:
        points = ' '.join(f'{x:.1f},{y:.1f}' for x, y in corners(cell['x'], cell['y']))
        svg.append(f'<polygon points="{points}" fill="#e77732" opacity="{0.08 + cell["interest"] * .55:.3f}" stroke="#b9763a" stroke-width=".4"/>')
    for road in data['roads']:
        points = ' '.join(f'{x},{y}' for x, y in road['points'])
        width = 2 if road['class'] == 'major' else 0.7
        svg.append(f'<polyline points="{points}" fill="none" stroke="#737777" stroke-width="{width}"/>')
    for label in data['labels']:
        anchor = 'start' if label['x'] < 80 else 'end' if label['x'] > 920 else 'middle'
        svg.append(f'<text x="{label["x"]}" y="{label["y"]}" transform="rotate({label["angle"]} {label["x"]} {label["y"]})" text-anchor="{anchor}" font-family="sans-serif" font-size="12" fill="#23445b">{escape(label["text"])}</text>')
    for spot in data['venueSpots']:
        x, y = spot['x'], spot['y']
        svg.append(f'<circle cx="{x}" cy="{y}" r="7" fill="#7b2350" stroke="white" stroke-width="2"/><text x="{x + 10}" y="{y - 10}" font-family="sans-serif" font-size="15" fill="#58163a">{spot["id"]}</text>')
    svg.append('</svg>')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(svg), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    data = build(args.raw)
    data['checksum'] = hashlib.sha256(compact(data).encode('utf-8')).hexdigest()
    payload = compact(data).encode('utf-8')
    if len(payload) >= 300_000:
        raise ValueError(f'Output is too large: {len(payload)} bytes')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(payload)
    preview(data, Path(__file__).parent / 'out' / 'portland-preview.svg')
    print('File size:', len(payload), 'bytes')
    print('Counts:', sum(len(f['rings']) for f in data['water']), 'water rings,', len(data['roads']), 'roads,', len(data['heat']), 'heat cells')
    print('Max jobs:', max(c['jobs'] for c in data['heat']))


if __name__ == '__main__':
    main()
