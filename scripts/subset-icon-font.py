#!/usr/bin/env python3
"""media/material-symbols-outlined.woff2 を、実際に使うアイコンだけのサブセットに作り直す。

フル版の Material Symbols は約 3.9MB あり、VSIX のサイズをほぼ単独で決めてしまう。
NaviCom が使うのは 90 個程度なので、リガチャを保ったまま必要な字形だけを残す。

使い方:

    pip install fonttools brotli
    # フル版を https://fonts.google.com/icons から取得して置く
    python3 scripts/subset-icon-font.py path/to/MaterialSymbolsOutlined.woff2

media/icon-subset.json のアイコン一覧は src/ を走査して書き直す。
ビルド時の検査は scripts/check-icon-subset.mjs が行う。
"""

from __future__ import annotations

import json
import hashlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FONT_PATH = REPO_ROOT / "media" / "material-symbols-outlined.woff2"
MANIFEST_PATH = REPO_ROOT / "media" / "icon-subset.json"
SOURCE_ROOT = REPO_ROOT / "src"

# CSS 側は font-variation-settings を使わず font-weight: normal 固定なので、既定インスタンスへ固定する。
INSTANCE = {"FILL": 0, "GRAD": 0, "opsz": 24, "wght": 400}

SPAN_PATTERN = re.compile(r"material-symbols-outlined[^>]*>([\s\S]*?)<")
LITERAL_PATTERN = re.compile(r'(["\'])([a-z0-9_]+)\1')
ICON_PROP_PATTERN = re.compile(r'\bicon\s*[:=]\s*(["\'])([a-z0-9_]+)\1')
PLAIN_NAME = re.compile(r"^[a-z0-9_]+$")


def collect_icon_names() -> list[str]:
    names: set[str] = set()
    for path in list(SOURCE_ROOT.rglob("*.ts")) + list(SOURCE_ROOT.rglob("*.tsx")):
        source = path.read_text(encoding="utf-8")
        for body in SPAN_PATTERN.findall(source):
            literal = body.strip()
            if PLAIN_NAME.match(literal):
                names.add(literal)
            else:
                names.update(match.group(2) for match in LITERAL_PATTERN.finditer(literal))
        names.update(match.group(2) for match in ICON_PROP_PATTERN.finditer(source))
    return sorted(names)


def build_ligature_map(font) -> dict[tuple[str, tuple[str, ...]], str]:
    ligatures: dict[tuple[str, tuple[str, ...]], str] = {}
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for subtable in lookup.SubTable:
            if getattr(subtable, "LookupType", None) == 7:
                subtable = subtable.ExtSubTable
            if subtable.__class__.__name__ != "LigatureSubst":
                continue
            for first, entries in subtable.ligatures.items():
                for entry in entries:
                    ligatures[(first, tuple(entry.Component))] = entry.LigGlyph
    return ligatures


def resolve_glyphs(font, icon_names: list[str]) -> dict[str, str]:
    cmap = font.getBestCmap()
    ligatures = build_ligature_map(font)
    resolved: dict[str, str] = {}
    unresolved: list[str] = []
    for name in icon_names:
        glyphs = [cmap.get(ord(char)) for char in name]
        if any(glyph is None for glyph in glyphs):
            unresolved.append(name)
            continue
        target = ligatures.get((glyphs[0], tuple(glyphs[1:])))
        if target is None:
            unresolved.append(name)
        else:
            resolved[name] = target
    if unresolved:
        raise SystemExit(f"These icon names do not exist in the source font: {', '.join(unresolved)}")
    return resolved


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {sys.argv[0]} <full-material-symbols.woff2>")

    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    source_font = Path(sys.argv[1])
    icon_names = collect_icon_names()
    print(f"icons found in src/: {len(icon_names)}")

    font = TTFont(source_font)
    glyph_by_icon = resolve_glyphs(font, icon_names)
    # リガチャの入力側になる文字。これがないと合字が成立しない。
    characters = "".join(sorted(set("".join(icon_names))))

    with tempfile.TemporaryDirectory() as work_dir:
        instanced_path = Path(work_dir) / "instanced.woff2"
        instanced = instancer.instantiateVariableFont(font, INSTANCE, inplace=False, updateFontNames=False)
        instanced.flavor = "woff2"
        instanced.save(instanced_path)

        subprocess.run(
            [
                sys.executable,
                "-m",
                "fontTools.subset",
                str(instanced_path),
                f"--output-file={FONT_PATH}",
                "--flavor=woff2",
                f"--glyphs={','.join(sorted(set(glyph_by_icon.values())))}",
                f"--text={characters}",
                # このフォントの合字は liga ではなく rlig / rclt に入っている。
                "--layout-features=rlig,rclt",
                # 閉包を切らないと、残した文字から作れる合字がすべて引き込まれてサブセットにならない。
                "--no-layout-closure",
                "--notdef-outline",
                "--no-hinting",
                "--desubroutinize",
            ],
            check=True,
        )

    manifest = {
        "source": "Material Symbols Outlined (variable)",
        "license": "media/material-symbols-LICENSE.txt",
        "instance": INSTANCE,
        "note": "使用アイコンだけを含むサブセット。アイコンを増やしたら scripts/subset-icon-font.py で作り直す。",
        "maxBytes": 65536,
        "sha256": hashlib.sha256(FONT_PATH.read_bytes()).hexdigest(),
        "icons": icon_names,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {FONT_PATH.relative_to(REPO_ROOT)}: {FONT_PATH.stat().st_size} bytes")


if __name__ == "__main__":
    main()
