#!/usr/bin/env python3
"""Generate the Phase 6 Indian-language compatibility PDFs.

The existing fpdf2 fixture generator documents a real ToUnicode limitation for
HarfBuzz-shaped Indic text. Phase 6 must exercise extraction as well as visual
appearance, so this generator uses HarfBuzz to shape Noto glyphs, draws the
resulting outlines as PDF vectors, and adds one invisible, selectable text run
per line with a correct CID/ToUnicode map. This preserves logical source text
for PDF.js selection, search, copy and vector-preserving print tests while the
visible outlines use the exact embedded Noto glyph shapes.

A one-page companion fixture paints Tamil as visible PDF text with an
embedded Noto TrueType font, independently covering PDF.js font painting.
The missing-font fixture contains a visible Tamil text run, then removes its
embedded Tamil TTF stream but retains its ToUnicode map to exercise fallback
without sacrificing selectable/searchable text.

Requires: pip install fpdf2 uharfbuzz fonttools pypdf
"""

from __future__ import annotations

import os
import struct
import sys
import unicodedata
import zlib
from dataclasses import dataclass
from pathlib import Path

try:
    import uharfbuzz as hb
except ImportError:
    print("ERROR: uharfbuzz is required: pip install uharfbuzz fonttools pypdf", file=sys.stderr)
    sys.exit(1)

try:
    from fpdf import FPDF
except ImportError:
    print("ERROR: fpdf2 is required: pip install fpdf2", file=sys.stderr)
    sys.exit(1)

try:
    from fontTools.pens.basePen import BasePen
    from fontTools.ttLib import TTFont
except ImportError:
    print("ERROR: fonttools is required: pip install uharfbuzz fonttools pypdf", file=sys.stderr)
    sys.exit(1)

try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject
except ImportError:
    print("ERROR: pypdf is required: pip install uharfbuzz fonttools pypdf", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
FONT_ROOT = ROOT / "node_modules" / "@expo-google-fonts"
PAGE_W = 595.276  # ISO A4 in PDF points
PAGE_H = 841.890
MARGIN = 38.0

FONT_FILES = {
    "Devanagari": ("noto-sans-devanagari", "NotoSansDevanagari_400Regular.ttf"),
    "Gurmukhi": ("noto-sans-gurmukhi", "NotoSansGurmukhi_400Regular.ttf"),
    "Bengali": ("noto-sans-bengali", "NotoSansBengali_400Regular.ttf"),
    "Gujarati": ("noto-sans-gujarati", "NotoSansGujarati_400Regular.ttf"),
    "Tamil": ("noto-sans-tamil", "NotoSansTamil_400Regular.ttf"),
    "Telugu": ("noto-sans-telugu", "NotoSansTelugu_400Regular.ttf"),
    "Kannada": ("noto-sans-kannada", "NotoSansKannada_400Regular.ttf"),
    "Malayalam": ("noto-sans-malayalam", "NotoSansMalayalam_400Regular.ttf"),
    "Odia": ("noto-sans-oriya", "NotoSansOriya_400Regular.ttf"),
    "Urdu": ("noto-nastaliq-urdu", "NotoNastaliqUrdu_400Regular.ttf"),
}

# Assamese uses Bengali script and the Bengali font, which contains the
# Assamese-specific characters used here.
LANGUAGES = [
    {"id": "en", "name": "English", "font": "Devanagari", "script": "Latn", "language": "eng", "direction": "ltr", "sample": "Clear text stays selectable, searchable, and printable in English.", "query": "LANGKEY"},
    {"id": "hi", "name": "Hindi / Devanagari", "font": "Devanagari", "script": "Deva", "language": "hin", "direction": "ltr", "sample": "हिंदी पाठ में क्षत्रिय, प्रज्ञा, श्रेणी और विद्यालय के उदाहरण हैं।", "query": "नमूना"},
    {"id": "pa", "name": "Punjabi / Gurmukhi", "font": "Gurmukhi", "script": "Guru", "language": "pan", "direction": "ltr", "sample": "ਪੰਜਾਬੀ ਪਾਠ ਵਿੱਚ ਖੇਤੀ, ਸਿੱਖਿਆ ਅਤੇ ਵੱਖ-ਵੱਖ ਲਗਾਂ ਦੀ ਜਾਂਚ ਹੈ।", "query": "ਕੁੰਜੀ"},
    {"id": "bn", "name": "Bengali", "font": "Bengali", "script": "Beng", "language": "ben", "direction": "ltr", "sample": "বাংলা ভাষায় শিক্ষা, যুক্তাক্ষর এবং স্বরচিহ্নের পরীক্ষা।", "query": "কীচিহ্ন"},
    {"id": "gu", "name": "Gujarati", "font": "Gujarati", "script": "Gujr", "language": "guj", "direction": "ltr", "sample": "ગુજરાતી ભાષામાં વાંચન, શોધ અને છાપકામની ચકાસણી।", "query": "કસોટી"},
    {"id": "mr", "name": "Marathi / Devanagari", "font": "Devanagari", "script": "Deva", "language": "mar", "direction": "ltr", "sample": "मराठी वाचनात ज्ञान, शोध आणि संयुक्ताक्षरांची चाचणी आहे।", "query": "चिन्ह"},
    {"id": "ta", "name": "Tamil", "font": "Tamil", "script": "Taml", "language": "tam", "direction": "ltr", "sample": "தமிழ் மொழியில் வாசிப்பு, தேடல், தேர்வு மற்றும் அச்சிடுதல் சோதனை।", "query": "குறி"},
    {"id": "te", "name": "Telugu", "font": "Telugu", "script": "Telu", "language": "tel", "direction": "ltr", "sample": "తెలుగు భాషలో పఠనం, శోధన, ఎంపిక మరియు ముద్రణ పరీక్ష।", "query": "సంకేతం"},
    {"id": "kn", "name": "Kannada", "font": "Kannada", "script": "Knda", "language": "kan", "direction": "ltr", "sample": "ಕನ್ನಡ ಭಾಷೆಯಲ್ಲಿ ಓದು, ಹುಡುಕಾಟ, ಆಯ್ಕೆ ಮತ್ತು ಮುದ್ರಣ ಪರೀಕ್ಷೆ।", "query": "ಗುರುತು"},
    {"id": "ml", "name": "Malayalam", "font": "Malayalam", "script": "Mlym", "language": "mal", "direction": "ltr", "sample": "മലയാളത്തിൽ വായന, തിരയൽ, തിരഞ്ഞെടുപ്പ്, അച്ചടി എന്നിവ പരിശോധിക്കുക।", "query": "കുറി"},
    {"id": "or", "name": "Odia", "font": "Odia", "script": "Orya", "language": "ori", "direction": "ltr", "sample": "ଓଡ଼ିଆ ଭାଷାରେ ପଢ଼ିବା, ଖୋଜିବା ଓ ଛାପିବା ପରୀକ୍ଷା।", "query": "ଚିହ୍ନ"},
    {"id": "as", "name": "Assamese / Bengali script", "font": "Bengali", "script": "Beng", "language": "asm", "direction": "ltr", "sample": "অসমীয়া ভাষাত পঢ়া, বিচৰা আৰু ছপা পৰীক্ষা কৰা হৈছে।", "query": "চাবি"},
    {"id": "ur", "name": "Urdu / RTL", "font": "Urdu", "script": "Arab", "language": "urd", "direction": "rtl", "sample": "اردو زبان میں تلاش، انتخاب، نقل اور طباعت کی آزمائش۔", "query": "کلید"},
]


@dataclass
class Run:
    text: str
    font: str
    script: str
    language: str
    direction: str
    size: float
    x: float
    y: float


@dataclass
class Glyph:
    gid: int
    x: float
    y: float
    cluster: int
    output_index: int


@dataclass
class Cluster:
    cid: int
    text: str
    width: float
    gid: int


@dataclass
class ShapedRun:
    run: Run
    glyphs_visual: list[Glyph]
    clusters_logical: list[Cluster]


class PdfPathPen(BasePen):
    """Convert TrueType quadratic outlines to PDF path commands."""

    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.commands: list[str] = []

    @staticmethod
    def fmt(value: float) -> str:
        return f"{value:.4f}".rstrip("0").rstrip(".") or "0"

    def _moveTo(self, point):
        self.commands.append(f"{self.fmt(point[0])} {self.fmt(point[1])} m")

    def _lineTo(self, point):
        self.commands.append(f"{self.fmt(point[0])} {self.fmt(point[1])} l")

    def _curveToOne(self, point1, point2, point3):
        self.commands.append(
            f"{self.fmt(point1[0])} {self.fmt(point1[1])} "
            f"{self.fmt(point2[0])} {self.fmt(point2[1])} "
            f"{self.fmt(point3[0])} {self.fmt(point3[1])} c"
        )

    def _qCurveToOne(self, control, end):
        start = self._getCurrentPoint()
        p1 = (start[0] + (2 / 3) * (control[0] - start[0]), start[1] + (2 / 3) * (control[1] - start[1]))
        p2 = (end[0] + (2 / 3) * (control[0] - end[0]), end[1] + (2 / 3) * (control[1] - end[1]))
        self._curveToOne(p1, p2, end)

    def _closePath(self):
        self.commands.append("h")

    def _endPath(self):
        self.commands.append("n")

    def as_pdf(self) -> str:
        return " ".join(self.commands)


class PdfObjects:
    """Minimal PDF 1.7 object/xref writer."""

    def __init__(self):
        self.objects: list[bytes | None] = [None]

    def reserve(self) -> int:
        self.objects.append(None)
        return len(self.objects) - 1

    def add(self, data: bytes | str) -> int:
        ref = self.reserve()
        self.set(ref, data)
        return ref

    def set(self, ref: int, data: bytes | str) -> None:
        self.objects[ref] = data.encode("ascii") if isinstance(data, str) else data

    def stream(self, dictionary: str, payload: bytes, compress: bool = True) -> int:
        if compress:
            payload = zlib.compress(payload, level=9)
            dictionary += " /Filter /FlateDecode"
        body = f"<< {dictionary} /Length {len(payload)} >>\nstream\n".encode("ascii") + payload + b"\nendstream"
        return self.add(body)

    def serialize(self, root_ref: int, info_ref: int) -> bytes:
        output = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for number, body in enumerate(self.objects[1:], 1):
            if body is None:
                raise RuntimeError(f"PDF object {number} was reserved but not written")
            offsets.append(len(output))
            output.extend(f"{number} 0 obj\n".encode("ascii"))
            output.extend(body)
            output.extend(b"\nendobj\n")
        xref = len(output)
        output.extend(f"xref\n0 {len(self.objects)}\n".encode("ascii"))
        output.extend(b"0000000000 65535 f \n")
        for offset in offsets[1:]:
            output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
        output.extend(f"trailer\n<< /Size {len(self.objects)} /Root {root_ref} 0 R /Info {info_ref} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
        return bytes(output)


def font_path(name: str) -> Path:
    package, filename = FONT_FILES[name]
    return FONT_ROOT / package / "400Regular" / filename


def reverse_graphemes(text: str) -> str:
    """Approximate extended-grapheme reversal for the RTL fixture string.

    This fixture's Urdu lines are Arabic-script runs without mixed Latin text.
    Keep combining marks, join controls and variation selectors with their
    base character while reversing the logical sequence for PDF.js's bidi
    text-content normalization.
    """
    clusters: list[str] = []
    join_next = False
    for char in text:
        category = unicodedata.category(char)
        is_mark = category in {"Mn", "Mc", "Me"}
        is_join_control = char in {"\u200c", "\u200d", "\ufe0e", "\ufe0f"}
        if clusters and (is_mark or is_join_control or join_next):
            clusters[-1] += char
        else:
            clusters.append(char)
        join_next = char == "\u200d"
    return "".join(reversed(clusters))


class FontData:
    def __init__(self, name: str, path: Path):
        self.name = name
        self.path = path
        self.ttf = path.read_bytes()
        self.blob = hb.Blob.from_file_path(str(path))
        self.face = hb.Face(self.blob)
        self.upem = self.face.upem
        self.hb_font = hb.Font(self.face)
        self.hb_font.scale = (self.upem, self.upem)
        self.ttfont = TTFont(str(path), lazy=False)
        self.glyph_set = self.ttfont.getGlyphSet()
        self.glyph_names = self.ttfont.getGlyphOrder()
        self.cid_next = 1
        self.clusters: list[Cluster] = []

        head = self.ttfont["head"]
        hhea = self.ttfont["hhea"]
        os2 = self.ttfont["OS/2"]
        scale = 1000 / self.upem
        self.bbox = [round(v * scale, 3) for v in (head.xMin, head.yMin, head.xMax, head.yMax)]
        self.ascent = round(hhea.ascent * scale, 3)
        self.descent = round(hhea.descent * scale, 3)
        self.cap_height = round(getattr(os2, "sCapHeight", hhea.ascent) * scale, 3)

    def shape(self, run: Run) -> ShapedRun:
        codepoints = [ord(char) for char in run.text]
        buffer = hb.Buffer()
        buffer.add_codepoints(codepoints)
        buffer.direction = run.direction
        buffer.script = run.script
        buffer.language = run.language
        buffer.cluster_level = hb.BufferClusterLevel.MONOTONE_GRAPHEMES
        hb.shape(self.hb_font, buffer)

        infos = list(buffer.glyph_infos)
        positions = list(buffer.glyph_positions)
        if not infos:
            return ShapedRun(run, [], [])

        cluster_starts = sorted({info.cluster for info in infos})
        source_for_cluster = {}
        for index, start in enumerate(cluster_starts):
            end = cluster_starts[index + 1] if index + 1 < len(cluster_starts) else len(codepoints)
            source_for_cluster[start] = "".join(chr(cp) for cp in codepoints[start:end])

        total_x = sum(position.x_advance for position in positions)
        total_width = total_x * run.size / self.upem
        start_x = run.x if run.direction == "ltr" else run.x - total_width
        scale = run.size / self.upem
        pen_x = 0
        pen_y = 0
        visual: list[Glyph] = []
        group_positions: dict[int, list[tuple[int, int, int, int]]] = {}
        for output_index, (info, position) in enumerate(zip(infos, positions)):
            glyph = Glyph(
                gid=info.codepoint,
                x=round(start_x + (pen_x + position.x_offset) * scale, 4),
                y=round(run.y + (pen_y + position.y_offset) * scale, 4),
                cluster=info.cluster,
                output_index=output_index,
            )
            visual.append(glyph)
            group_positions.setdefault(info.cluster, []).append((
                info.codepoint,
                position.x_advance,
                output_index,
                info.cluster,
            ))
            pen_x += position.x_advance
            pen_y += position.y_advance

        # Use one semantic CID per source run. The visible word is drawn from
        # the HarfBuzz glyph paths above, while a single invisible Tj provides
        # exact extraction text and avoids PDF.js inserting inferred spaces
        # between base/mark/conjunct glyph fragments.
        cid = self.cid_next
        self.cid_next += 1
        source_text = reverse_graphemes(run.text) if run.direction == "rtl" else run.text
        semantic = Cluster(
            cid=cid,
            text=source_text,
            width=round(abs(total_x) * 1000 / self.upem, 3),
            gid=infos[0].codepoint,
        )
        self.clusters.append(semantic)
        return ShapedRun(run, visual, [semantic])

    def draw_glyph(self, glyph: Glyph) -> str:
        if glyph.gid <= 0 or glyph.gid >= len(self.glyph_names):
            return ""
        glyph_name = self.glyph_names[glyph.gid]
        pen = PdfPathPen(self.glyph_set)
        self.glyph_set[glyph_name].draw(pen)
        path = pen.as_pdf()
        if not path:
            return ""
        scale = self._active_run_size / self.upem
        return f"q {scale:.8g} 0 0 {scale:.8g} {glyph.x:.6f} {glyph.y:.6f} cm {path} f Q\n"

    def set_run_size(self, size: float) -> None:
        self._active_run_size = size


def hb_measure(text: str, font: FontData, script: str, language: str, direction: str, size: float) -> float:
    buf = hb.Buffer()
    buf.add_codepoints([ord(char) for char in text])
    buf.direction = direction
    buf.script = script
    buf.language = language
    hb.shape(font.hb_font, buf)
    return sum(pos.x_advance for pos in buf.glyph_positions) * size / font.upem


def make_run(text: str, font: str = "Devanagari", script: str = "Latn", language: str = "eng", direction: str = "ltr", size: float = 12, x: float = MARGIN, y: float = 780) -> Run:
    return Run(text, font, script, language, direction, size, x, y)


def make_pages(fonts: dict[str, FontData]) -> list[list[Run]]:
    pages: list[list[Run]] = []
    pages.append([
        make_run("Cambuz PDF Reader | Indian-language compatibility", size=9, y=812),
        make_run("Indian-language compatibility fixture", size=20, y=770),
        make_run("English, Hindi, Punjabi, Bengali, Gujarati, Marathi, Tamil, Telugu, Kannada, Malayalam, Odia, Assamese and Urdu.", size=13, y=733),
        make_run("Embedded Noto fonts; shaped text; real selection, search, copy and print checks.", size=13, y=709),
    ])

    for entry in LANGUAGES:
        y = 812
        runs = [make_run("Cambuz PDF Reader | Indian-language compatibility", size=9, y=y)]
        y -= 42
        runs.append(make_run(f"{entry['id'].upper()} - {entry['name']}", size=17, y=y))
        y -= 43
        sample_size = 14
        available = PAGE_W - 2 * MARGIN
        measured = hb_measure(entry["sample"], fonts[entry["font"]], entry["script"], entry["language"], entry["direction"], sample_size)
        if measured > available:
            sample_size *= available / measured * 0.95
        runs.append(make_run(
            entry["sample"], font=entry["font"], script=entry["script"], language=entry["language"],
            direction=entry["direction"], size=sample_size,
            x=PAGE_W - MARGIN if entry["direction"] == "rtl" else MARGIN, y=y,
        ))
        y -= 35
        keyline = f"{entry['query']}  {entry['query']}"
        runs.append(make_run(
            keyline, font=entry["font"], script=entry["script"], language=entry["language"],
            direction=entry["direction"], size=17,
            x=PAGE_W - MARGIN if entry["direction"] == "rtl" else MARGIN, y=y,
        ))
        runs.append(make_run("Phase 6 test page", size=9, y=24))
        pages.append(runs)

    mixed = [make_run("Mixed scripts on one page", size=18, y=770)]
    y = 735
    for entry in LANGUAGES[:-1]:
        mixed.append(make_run(
            f"{entry['name']}: {entry['sample']}", font=entry["font"],
            script=entry["script"], language=entry["language"], direction=entry["direction"],
            size=10.5, y=y,
        ))
        y -= 31
    urdu = LANGUAGES[-1]
    mixed.append(make_run(
        f"{urdu['sample']}  {urdu['query']}", font=urdu["font"], script=urdu["script"],
        language=urdu["language"], direction="rtl", size=14, x=PAGE_W - MARGIN, y=y,
    ))
    pages.append(mixed)

    pages.append([
        make_run("Combining marks and conjunct stress", size=18, y=770),
        make_run("NFC: क़िला   NFD: क़िला", font="Devanagari", script="Deva", language="hin", size=17, y=725),
        make_run("Devanagari conjuncts: क्षत्रिय  प्रज्ञा  श्रेणी", font="Devanagari", script="Deva", language="hin", size=16, y=685),
        make_run("Gurmukhi: ਪੰਜਾਬੀ  ਪੁੱਤਰ  ਦੁੱਧ  ਸਿੱਖਿਆ", font="Gurmukhi", script="Guru", language="pan", size=16, y=645),
        make_run("Bengali: বাংলা  শিক্ষা  যুক্তাক্ষর  ড়", font="Bengali", script="Beng", language="ben", size=16, y=605),
        make_run("اُردُو، تعلیم، نشان، تلاش", font="Urdu", script="Arab", language="urd", direction="rtl", size=16, x=PAGE_W - MARGIN, y=565),
    ])
    return pages


def pdf_hex_unicode(text: str) -> str:
    return text.encode("utf-16-be").hex().upper()


def make_tounicode(font: FontData) -> bytes:
    lines = [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin",
        "begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        f"/CMapName /Cambuz{font.name}Unicode def",
        "/CMapType 2 def",
        "1 begincodespacerange",
        "<0000> <FFFF>",
        "endcodespacerange",
    ]
    for offset in range(0, len(font.clusters), 100):
        subset = font.clusters[offset : offset + 100]
        lines.append(f"{len(subset)} beginbfchar")
        for cluster in subset:
            lines.append(f"<{cluster.cid:04X}> <{pdf_hex_unicode(cluster.text)}>")
        lines.append("endbfchar")
    lines.extend(["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end", ""])
    return "\n".join(lines).encode("ascii")


def add_font_objects(pdf: PdfObjects, font: FontData) -> int:
    font_file = pdf.stream(f"/Length1 {len(font.ttf)}", font.ttf)
    descriptor = pdf.add(
        "<< /Type /FontDescriptor "
        f"/FontName /Cambuz{font.name} /Flags 4 "
        f"/FontBBox [{font.bbox[0]} {font.bbox[1]} {font.bbox[2]} {font.bbox[3]}] "
        f"/ItalicAngle 0 /Ascent {font.ascent} /Descent {font.descent} "
        f"/CapHeight {font.cap_height} /StemV 80 /FontFile2 {font_file} 0 R >>"
    )
    cid_map_bytes = bytearray(2 * font.cid_next)
    for cluster in font.clusters:
        struct.pack_into(">H", cid_map_bytes, cluster.cid * 2, cluster.gid)
    cid_map = pdf.stream("", bytes(cid_map_bytes), compress=False)
    widths = " ".join(f"{cluster.width:g}" for cluster in font.clusters)
    descendant = pdf.add(
        "<< /Type /Font /Subtype /CIDFontType2 "
        f"/BaseFont /Cambuz{font.name} "
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
        f"/FontDescriptor {descriptor} 0 R /CIDToGIDMap {cid_map} 0 R "
        f"/DW 1000 /W [1 [{widths}]] >>"
    )
    cmap = pdf.stream("", make_tounicode(font))
    return pdf.add(
        "<< /Type /Font /Subtype /Type0 "
        f"/BaseFont /Cambuz{font.name} /Encoding /Identity-H "
        f"/DescendantFonts [{descendant} 0 R] /ToUnicode {cmap} 0 R >>"
    )


def encode_semantic_run(shaped: ShapedRun, font_resource: str, visible: bool = False) -> bytes:
    run = shaped.run
    cids = "".join(f"{cluster.cid:04X}" for cluster in shaped.clusters_logical)
    total_width = sum(cluster.width for cluster in shaped.clusters_logical) * run.size / 1000
    text_x = run.x if run.direction == "ltr" else run.x - total_width
    render_mode = 0 if visible else 3
    return (
        f"BT /{font_resource} {run.size:g} Tf {render_mode} Tr "
        f"1 0 0 1 {text_x:.6f} {run.y:.6f} Tm <{cids}> Tj ET\n"
    ).encode("ascii")


def encode_visible_outlines(shaped: ShapedRun, font: FontData) -> bytes:
    font.set_run_size(shaped.run.size)
    output = []
    # Draw in HarfBuzz visual order; every glyph has its own position so Arabic
    # offsets/marks and Indic reordered matras exactly follow the shaper.
    for glyph in shaped.glyphs_visual:
        outline = font.draw_glyph(glyph)
        if outline:
            output.append(outline)
    return "".join(output).encode("ascii")


def make_pdf_bytes(tamil_fallback: bool = False) -> tuple[bytes, dict[str, FontData], list[list[ShapedRun]]]:
    fonts = {name: FontData(name, font_path(name)) for name in FONT_FILES}
    pages = make_pages(fonts)
    shaped_pages: list[list[ShapedRun]] = []
    for page in pages:
        shaped_page = []
        for run in page:
            shaped_page.append(fonts[run.font].shape(run))
        shaped_pages.append(shaped_page)

    pdf = PdfObjects()
    catalog_ref = pdf.reserve()
    pages_ref = pdf.reserve()
    font_refs = {name: add_font_objects(pdf, font) for name, font in fonts.items()}
    page_refs = []

    for page_index, shaped_page in enumerate(shaped_pages):
        resources = " ".join(f"/{name} {ref} 0 R" for name, ref in font_refs.items())
        content = bytearray(b"q\n0 g\n")
        is_tamil_fallback_page = tamil_fallback and page_index == 7
        for shaped in shaped_page:
            if not is_tamil_fallback_page:
                content.extend(encode_visible_outlines(shaped, fonts[shaped.run.font]))
            content.extend(encode_semantic_run(shaped, shaped.run.font, visible=is_tamil_fallback_page))
        content.extend(b"Q\n")
        content_ref = pdf.stream("", bytes(content))
        page_refs.append(pdf.add(
            "<< /Type /Page "
            f"/Parent {pages_ref} 0 R /MediaBox [0 0 {PAGE_W:.3f} {PAGE_H:.3f}] "
            f"/Resources << /Font << {resources} >> >> /Contents {content_ref} 0 R >>"
        ))

    kids = " ".join(f"{ref} 0 R" for ref in page_refs)
    pdf.set(pages_ref, f"<< /Type /Pages /Kids [{kids}] /Count {len(page_refs)} >>")
    pdf.set(catalog_ref, f"<< /Type /Catalog /Pages {pages_ref} 0 R >>")
    info_ref = pdf.add(
        "<< /Title (Cambuz Phase 6 Indian-language Compatibility Fixture) "
        "/Author (Cambuz PDF Reader) "
        "/Subject (English and twelve Indian language/script compatibility tests) "
        "/Creator (Cambuz Phase 6 HarfBuzz fixture generator) >>"
    )
    return pdf.serialize(catalog_ref, info_ref), fonts, shaped_pages


def create_embedded_font_pdf() -> None:
    """Create a visible Tamil page painted with an embedded Noto TrueType font.

    The main fixture's visible glyphs are vector outlines to isolate shaping
    from ToUnicode behavior; this companion fixture verifies PDF.js's actual
    embedded-font text paint path independently.
    """
    pdf = FPDF(unit="mm", format="A4")
    pdf.set_auto_page_break(False)
    pdf.add_page()
    pdf.set_font("helvetica", style="B", size=16)
    pdf.text(14, 24, "Embedded Noto Sans Tamil font rendering")
    pdf.add_font("NotoTamil", fname=str(font_path("Tamil")))
    pdf.set_font("NotoTamil", size=17)
    pdf.text(14, 48, "தமிழ் எழுத்துரு — தேர்வு மற்றும் வாசிப்பு")
    pdf.set_font("NotoTamil", size=12)
    pdf.text(14, 66, "தமிழ் மொழியில் வாசிப்பு, தேடல், தேர்வு மற்றும் அச்சிடுதல் சோதனை।")
    output = SAMPLES / "phase6-embedded-font.pdf"
    pdf.output(str(output))
    print("Created: samples/phase6-embedded-font.pdf (visible Tamil text with embedded Noto Sans Tamil)")


def create_missing_font_pdf(source_path: Path) -> None:
    reader = PdfReader(str(source_path))
    writer = PdfWriter()
    writer.append(reader, pages=(7, 8))  # zero-based Tamil language page

    descriptors = []
    for page in writer.pages:
        resources = page.get("/Resources")
        fonts = resources.get_object().get("/Font") if resources else None
        if not fonts:
            continue
        for font_ref in fonts.get_object().values():
            font = font_ref.get_object()
            descendants = font.get("/DescendantFonts")
            candidates = [ref.get_object() for ref in descendants] if descendants else [font]
            for candidate in candidates:
                descriptor_ref = candidate.get("/FontDescriptor")
                if descriptor_ref:
                    descriptor = descriptor_ref.get_object()
                    if "CambuzTamil" in str(descriptor.get("/FontName", "")):
                        descriptors.append(descriptor)

    removed = 0
    for descriptor in descriptors:
        if "/FontFile2" in descriptor:
            del descriptor[NameObject("/FontFile2")]
            removed += 1
    if not removed:
        raise RuntimeError("Could not remove the embedded Noto Sans Tamil font stream from the fallback fixture")

    output = SAMPLES / "phase6-missing-font.pdf"
    with output.open("wb") as handle:
        writer.write(handle)
    print(f"Created: samples/phase6-missing-font.pdf (Tamil font missing; ToUnicode retained)")


def main() -> None:
    if len(LANGUAGES) != 13:
        raise RuntimeError("Phase 6 compatibility suite must cover English plus twelve target Indian languages")
    for name in FONT_FILES:
        if not font_path(name).exists():
            print(f"ERROR: font not found: {font_path(name)}", file=sys.stderr)
            print("Run npm install first; Noto font packages are development-only.", file=sys.stderr)
            sys.exit(1)

    SAMPLES.mkdir(parents=True, exist_ok=True)
    data, fonts, _ = make_pdf_bytes()
    output = SAMPLES / "phase6-indian-languages.pdf"
    output.write_bytes(data)
    print(f"Created: samples/phase6-indian-languages.pdf (16 pages, {len(data) / 1024:.0f} KiB)")
    for font in fonts.values():
        font.ttfont.close()

    create_embedded_font_pdf()
    fallback_data, fallback_fonts, _ = make_pdf_bytes(tamil_fallback=True)
    fallback_source = SAMPLES / "phase6-tmp-font-fallback.pdf"
    fallback_source.write_bytes(fallback_data)
    for font in fallback_fonts.values():
        font.ttfont.close()
    create_missing_font_pdf(fallback_source)
    fallback_source.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
