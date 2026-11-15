#!/usr/bin/env python3
"""Re-apply local patches to the course site. Safe to run repeatedly (e.g. after a course update).

1. Fill in empty figure links in m1.html, and show the error-discretization lab's angles in units of pi.
2. Build assets/ref-previews.js: preview snippets for links that point at another page.
3. Add the ref-preview scripts to every page.

Run from anywhere:  python3 local-patches/apply.py
"""
import glob
import json
import math
import os
import re

from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTAINERS = ['section', 'div', 'aside', 'article', 'header', 'main']
BLOCK = ['figure', 'li', 'p', 'blockquote', 'table', 'dd', 'dt', 'pre', 'details']
HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
MAX_PREVIEW = 120_000  # characters; figures with inline SVG run ~20k
SCRIPTS = '<script src="assets/ref-previews.js"></script><script src="assets/ref-preview.js"></script>'

M1_LABELS = {
    'm1-majority-crossing-figure': 'the crossing figure',
    'm1-three-obstacles-figure': 'the three-panel obstacle figure',
    'm1-bitflip-circuit-figure': 'the bit-flip circuit figure',
    'm1-spacetime-events-figure': 'the spacetime event figure',
}


def read(name):
    with open(os.path.join(ROOT, name), encoding='utf-8') as f:
        return f.read()


def write(name, text):
    with open(os.path.join(ROOT, name), 'w', encoding='utf-8') as f:
        f.write(text)


def fix_m1_links():
    s = read('m1.html')

    def label(m):
        text = M1_LABELS.get(m.group(1))
        if not text:
            return m.group(0)
        # Capitalize when the link starts a sentence.
        before = re.sub(r'<[^>]+>', '', s[max(0, m.start() - 40):m.start()]).rstrip()
        if not before or before[-1] in '.!?':
            text = text[0].upper() + text[1:]
        return f'<a href="#{m.group(1)}">{text}</a>'

    fixed = re.sub(r'<a href="#([^"]+)"></a>', label, s)
    if fixed != s:
        write('m1.html', fixed)
    print('m1 empty links left:', len(re.findall(r'<a href="#[^"]+"></a>', fixed)))


def replace_once(text, old, new, count=1, where=''):
    """Replace exactly `count` occurrences; a no-op when already patched."""
    if new in text:
        return text
    found = text.count(old)
    if found != count:
        raise SystemExit(f'{where}: expected {count} of {old[:60]!r}, found {found}; course changed, update apply.py')
    return text.replace(old, new)


SMALL_THETA = 0.2 / math.pi      # keeps the course's 0.2 rad exactly
EQUATOR_THETA = 0.5 / math.pi    # keeps the course's 0.5 rad exactly


def angles_in_pi():
    """Error-discretization lab: show theta, polar and azimuth in units of pi."""
    s = read('m1.html')
    specs = [
        ('theta', '"units":"rad","type":"number","range":[0,3.142],"range_tex":"[0,\\\\pi]","step":0.01,"default":0.2,',
         f'"units":"π rad","type":"number","range":[0,1],"range_tex":"[0,1]","step":0.001,"default":{SMALL_THETA!r},'),
        ('polar', '"units":"rad","type":"number","range":[0,3.142],"range_tex":"[0,\\\\pi]","step":0.01,"default":1.047,'
                  '"default_tex":"\\\\pi/3\\\\;\\\\text{(rounded)}"',
         '"units":"π rad","type":"number","range":[0,1],"range_tex":"[0,1]","step":0.001,"default":0.3333,'
         '"default_tex":"1/3"'),
        ('azimuth', '"units":"rad","type":"number","range":[0,6.283],"range_tex":"[0,2\\\\pi]","step":0.01,"default":0,',
         '"units":"π rad","type":"number","range":[0,2],"range_tex":"[0,2]","step":0.001,"default":0,'),
    ]
    for key, old, new in specs:
        s = replace_once(s, old, new, where=f'm1.html {key} spec')
        # Compiled control label: the first units string after this parameter's rendered meaning.
        i = s.index(f'"{key}":{{"meaning"')
        j = s.index('"units":"', i)
        if s.startswith('"units":"rad"', j):
            s = s[:j] + '"units":"× π rad"' + s[j + len('"units":"rad"'):]
    for old, new, count in [
        ('"values":{"theta":0.2,', f'"values":{{"theta":{SMALL_THETA!r},', 1),
        ('"values":{"theta":1.5708,', '"values":{"theta":0.5,', 1),
        ('"values":{"theta":3.1416,', '"values":{"theta":1,', 1),
        ('"polar":1.047,', '"polar":0.3333,', 3),
        ('"values":{"polar":1.5708,"theta":0.5,', f'"values":{{"polar":0.5,"theta":{EQUATOR_THETA!r},', 1),
        ('At \\\\(\\\\theta\\\\approx\\\\pi\\\\), the flagged outcome is almost certain. The rounded angle retains a clean '
         'probability of about \\\\(1.35\\\\times10^{-11}\\\\).',
         'At \\\\(\\\\theta=\\\\pi\\\\), the flagged outcome is certain and the clean branch is impossible.', 1),
    ]:
        s = replace_once(s, old, new, count=count, where='m1.html presets')
    write('m1.html', s)

    lab = 'assets/labs/error-discretization.js'
    js = read(lab)
    for old, new, count in [
        ('const result = ctx.model.compute(ctx.state.all());',
         '// Local patch: angle sliders are in units of pi; the model takes radians.\n'
         '      const values = ctx.state.all();\n'
         '      const result = ctx.model.compute({ ...values, theta: values.theta * Math.PI, polar: values.polar * Math.PI, azimuth: values.azimuth * Math.PI });', 1),
        ("x: { label: 'Rotation angle θ (rad)', domain: [0, 3.142] },", "x: { label: 'Rotation angle θ/π', domain: [0, 1] },", 1),
        ('const bits = flag.syndrome.join(\'\');',
         'const bits = flag.syndrome.join(\'\'), perPi = pts => pts.map(([x, y]) => [x / Math.PI, y]);', 1),
        ('points: s.clean }', 'points: perPi(s.clean) }', 1),
        ('points: s.flagged }', 'points: perPi(s.flagged) }', 1),
        ('points: s.unprotected }', 'points: perPi(s.unprotected) }', 1),
        ('x: p.theta,', 'x: p.theta / Math.PI,', 4),
        ('At θ=0.2, predict', 'At θ=0.2 rad (θ/π≈0.064), predict', 1),
        ('The preset angles are rounded numeric values; Full flip uses 3.1416 rad and can retain a tiny clean-branch probability.',
         'Angle sliders are in units of π; Full flip is exactly θ=π, so the clean branch is impossible.', 1),
        # Bloch sphere panel (assets/labs/error-discretization-bloch.js).
        ("ctx.warn(layout.notes, result.warnings.join(' ') || null);",
         "ctx.warn(layout.notes, result.warnings.join(' ') || null);\n      window.LocalBloch?.update(layout.plots, result);", 1),
    ]:
        js = replace_once(js, old, new, count=count, where=lab)
    write(lab, js)
    s = read('m1.html')
    s = replace_once(s, '<script defer src="assets/labs/error-discretization.js"></script>',
                     '<script defer src="assets/labs/error-discretization-bloch.js"></script>'
                     '<script defer src="assets/labs/error-discretization.js"></script>', where='m1.html bloch script')
    write('m1.html', s)
    print('lab angles shown in units of pi, Bloch sphere added')


def is_block(el):
    classes = el.get('class') or []
    return el.name in BLOCK or 'equation' in classes or (el.name == 'article' and 'source' in classes)


def summary(container, soup):
    """Title plus the first two paragraphs of a section or other large container."""
    heading = container.find(HEADINGS)
    if heading is None and container.get('data-title'):
        heading = soup.new_tag('h3')
        heading.string = container['data-title']
    return [n for n in [heading, *container.find_all('p', limit=3)] if n][:3]


def preview_root(el, soup):
    """Mirrors previewNodes() in assets/ref-preview.js."""
    if el.name in HEADINGS:
        return summary(el.find_parent('section') or el.parent, soup)
    if el.name in CONTAINERS and not is_block(el):
        return summary(el, soup)
    if is_block(el):
        return [el]
    parent = el.find_parent(is_block)
    return [parent or el]


def clean(el):
    if el.name == 'article' and 'source' in (el.get('class') or []):
        for ul in el.find_all('ul', recursive=False):
            ul.decompose()
    return el


def build_previews(pages):
    wanted = {}
    for page in pages:
        for page_to, frag in re.findall(r'<a\b[^>]*\bhref="([\w-]+\.html)#([^"]+)"', read(page)):
            if page_to != page and os.path.exists(os.path.join(ROOT, page_to)):
                wanted.setdefault(page_to, set()).add(frag)
    previews = {}
    for page_to, ids in sorted(wanted.items()):
        soup = BeautifulSoup(read(page_to), 'html.parser')
        for frag in sorted(ids):
            el = soup.find(id=frag)
            if el is None:
                continue
            nodes = preview_root(el, soup)
            html = ''.join(str(clean(BeautifulSoup(str(n), 'html.parser'))) for n in nodes)
            if len(html) > MAX_PREVIEW:
                nodes = summary(el, soup)
                while len(nodes) > 1 and len(''.join(map(str, nodes))) > MAX_PREVIEW:
                    nodes = nodes[:-1]
                html = ''.join(map(str, nodes))
            if len(html) > MAX_PREVIEW:
                continue  # no preview rather than a truncated one
            previews[f'{page_to}#{frag}'] = html
    body = json.dumps(previews, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    write('assets/ref-previews.js', '// Generated by local-patches/apply.py. Do not edit.\nwindow.REF_PREVIEWS=' + body + ';\n')
    print(f'previews: {len(previews)} targets, {len(body) // 1024} KiB')


def inject(pages):
    for page in pages:
        s = read(page)
        if 'assets/ref-preview.js' in s:
            continue
        write(page, s.replace('</body>', SCRIPTS + '</body>', 1))
    print('scripts on', len(pages), 'pages')


def main():
    pages = sorted(os.path.basename(p) for p in glob.glob(os.path.join(ROOT, '*.html')))
    fix_m1_links()
    angles_in_pi()
    build_previews(pages)
    inject(pages)


if __name__ == '__main__':
    main()
