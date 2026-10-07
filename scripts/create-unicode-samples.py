#!/usr/bin/env python3
"""Cambuz PDF Reader — Unicode sample PDF generator (Phase 2).

Creates Hindi (Devanagari), Punjabi (Gurmukhi) and multilingual sample PDFs
with properly *shaped* Indic text (HarfBuzz via fpdf2 + uharfbuzz), embedded
Noto fonts, document outlines and metadata.

Search-term design (verified by scripts/test-phase2.mjs):
  multilingual.pdf : "Punjab" x12, "पंजाब" x12, "ਪੰਜਾਬ" x12
  hindi-sample.pdf : "पंजाब" x6
  punjabi-sample.pdf : "ਪੰਜਾਬ" x6
The counted terms appear ONLY in the designated sentences — cover pages,
colophons and other filler text deliberately avoid them (substring search
means even "Punjabi"/"पंजाबी" would count, so those are avoided too).

Content constraint (sample-generator limitation, NOT a reader limitation):
fpdf2's HarfBuzz integration mis-encodes ToUnicode for (a) pre-base matras
(Devanagari ि / Gurmukhi ਿ, which reorder visually) and (b) some
ligature+matra / non-ligating half-form sequences — extraction then shows
CID-fallback garbage or inferred spaces. Real-world PDFs (browsers, office
suites) encode these correctly and the reader handles them fine. Every word
used below was empirically verified to extract byte-exact; the test suite
asserts full-text equality so any regression fails loudly. Phase 6
(Indian Language Excellence) will add richer fixtures, including real-world
documents with conjunct-heavy text.

Requires: pip install fpdf2 uharfbuzz
Fonts: npm devDependencies @expo-google-fonts/noto-sans-devanagari and
       @expo-google-fonts/noto-sans-gurmukhi (TTF files).
"""

import os
import sys

try:
    from fpdf import FPDF, XPos, YPos
except ImportError:
    print("ERROR: fpdf2 is required: pip install fpdf2 uharfbuzz", file=sys.stderr)
    sys.exit(1)

try:
    import uharfbuzz  # noqa: F401  (required for Indic shaping)
except ImportError:
    print("ERROR: uharfbuzz is required for Indic shaping: pip install uharfbuzz",
          file=sys.stderr)
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLES = os.path.join(ROOT, "samples")
DEVA_TTF = os.path.join(
    ROOT, "node_modules", "@expo-google-fonts", "noto-sans-devanagari",
    "400Regular", "NotoSansDevanagari_400Regular.ttf")
GURU_TTF = os.path.join(
    ROOT, "node_modules", "@expo-google-fonts", "noto-sans-gurmukhi",
    "400Regular", "NotoSansGurmukhi_400Regular.ttf")

for p in (DEVA_TTF, GURU_TTF):
    if not os.path.exists(p):
        print(f"ERROR: font not found: {p}", file=sys.stderr)
        print("Run: npm install --ignore-scripts", file=sys.stderr)
        sys.exit(1)

os.makedirs(SAMPLES, exist_ok=True)


class SamplePDF(FPDF):
    """A4 sample with footer page numbers and section helper."""

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", size=9)
        self.set_text_color(130, 130, 130)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def heading(self, text, font="Helvetica", size=22):
        self.set_font(font, size=size)
        self.set_text_color(20, 28, 40)
        self.set_text_shaping(True)
        self.multi_cell(0, 11, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(2)

    def subheading(self, text, font="Helvetica", size=14):
        self.set_font(font, size=size)
        self.set_text_color(70, 90, 130)
        self.set_text_shaping(True)
        self.multi_cell(0, 8, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(2)

    def para(self, text, font="Helvetica", size=12):
        self.set_font(font, size=size)
        self.set_text_color(40, 40, 40)
        self.set_text_shaping(True)
        self.multi_cell(0, 8, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(2)

    def mixed_line(self, runs, size=12):
        """One visual line from [(font, text), ...] runs."""
        self.set_text_color(40, 40, 40)
        self.set_text_shaping(True)
        for font, text in runs:
            self.set_font(font, size=size)
            self.write(8, text)
        self.ln(10)


def new_doc(title, author="Cambuz PDF Reader"):
    pdf = SamplePDF()
    pdf.set_auto_page_break(True, margin=20)
    pdf.set_title(title)
    pdf.set_author(author)
    pdf.set_creator("Cambuz sample generator (fpdf2)")
    pdf.add_font("NotoDeva", "", DEVA_TTF)
    pdf.add_font("NotoGuru", "", GURU_TTF)
    return pdf


# Sentence sets — each list carries exactly six occurrences of its term.
HINDI_SENTENCES = [
    "पंजाब उत्तर भारत का एक राज्य है।",
    "पंजाब की राजधानी चंडीगढ़ है।",
    "हर साल लाखों लोग पंजाब आते हैं।",
    "पंजाब के खेत बहुत उपजाऊ हैं।",
    "पांच जलधाराएं पंजाब को सींचती हैं।",
    "इस पृष्ठ पर पंजाब छह बार आता है।",
]

PUNJABI_SENTENCES = [
    "ਪੰਜਾਬ ਦੱਖਣੀ ਏਸ਼ੀਆ ਦਾ ਇੱਕ ਖੇਤਰ ਹੈ।",
    "ਪੰਜਾਬ ਦੀ ਰਾਜਧਾਨੀ ਚੰਡੀਗੜ੍ਹ ਹੈ।",
    "ਹਰ ਸਾਲ ਲੱਖਾਂ ਲੋਕ ਪੰਜਾਬ ਆਉਂਦੇ ਹਨ।",
    "ਪੰਜਾਬ ਦੇ ਖੇਤ ਬਹੁਤ ਉਪਜਾਊ ਹਨ।",
    "ਪੰਜ ਨਦੀਆਂ ਪੰਜਾਬ ਦੀ ਜਾਨ ਹਨ।",
    "ਇਹ ਪੰਨਾ ਪਰਖ ਲਈ ਪੰਜਾਬ ਨਾਮ ਛੇ ਵਾਰ ਵਰਤਦਾ ਹੈ।",
]

ENGLISH_SENTENCES = [
    "Punjab is a region in South Asia.",
    "The name Punjab means land of five rivers.",
    "Many travellers visit Punjab every year.",
    "The fields of Punjab are famously fertile.",
    "River waters shaped Punjab over centuries.",
    "This page mentions Punjab six times for testing.",
]


# ----------------------------------------------------------------------------
# Multilingual sample (7 pages, nested outline)
# ----------------------------------------------------------------------------

def create_multilingual():
    pdf = new_doc("Cambuz Multilingual Sample")
    pdf.set_subject("English, Hindi and Punjabi reading test")
    pdf.set_keywords("Punjab, multilingual, search test, unicode")

    # Page 1 — cover (no counted terms)
    pdf.add_page()
    pdf.start_section("Cover", level=0)
    pdf.ln(30)
    pdf.heading("Cambuz Multilingual Sample")
    pdf.mixed_line([("Helvetica", "English  |  "),
                    ("NotoDeva", "देवनागरी"),
                    ("Helvetica", "  |  Gurmukhi script")], size=14)
    pdf.para("Seven pages across three languages for exercising search, "
             "text selection, copying, thumbnails and bookmarks. The document "
             "outline lists every chapter below.")

    # Page 2 — English (6x "Punjab")
    pdf.add_page()
    pdf.start_section("English - Rivers and Fields", level=0)
    pdf.heading("English - Rivers and Fields")
    for s in ENGLISH_SENTENCES:
        pdf.para(s)

    # Page 3 — Hindi (6x "पंजाब")
    pdf.add_page()
    pdf.start_section("Hindi - नदी और खेत", level=0)
    pdf.heading("देवनागरी - नदी और खेत", font="NotoDeva")
    for s in HINDI_SENTENCES:
        pdf.para(s, font="NotoDeva")

    # Page 4 — Punjabi (6x "ਪੰਜਾਬ")
    pdf.add_page()
    pdf.start_section("Punjabi - Rivers and Fields", level=0)
    pdf.heading("ਨਦੀਆਂ ਅਤੇ ਖੇਤ", font="NotoGuru")
    for s in PUNJABI_SENTENCES:
        pdf.para(s, font="NotoGuru")

    # Page 5 — mixed (1x each)
    pdf.add_page()
    pdf.start_section("Mixed Scripts", level=0)
    pdf.start_section("Three scripts on one page", level=1)
    pdf.heading("Mixed Scripts")
    pdf.subheading("Two scripts, three lines")
    pdf.mixed_line([("Helvetica", "English line: Punjab (once on this page).")])
    pdf.mixed_line([("NotoDeva",
                     "देवनागरी उदाहरण: पंजाब (इस पृष्ठ पर एक बार)।")])
    pdf.mixed_line([("Helvetica", "Gurmukhi "),
                    ("NotoGuru",
                     "ਉਦਾਹਰਨ: ਪੰਜਾਬ (ਇਸ ਪੰਨੇ ਉਤੇ ਇੱਕ ਵਾਰ)।")])

    # Page 6 — search test (+5 each)
    pdf.add_page()
    pdf.start_section("Search Test - Repeated Terms", level=0)
    pdf.heading("Search Test - Repeated Terms")
    pdf.para("Each line below repeats the same three terms. Searching for any "
             "of them must find every line on this page.")
    for _ in range(5):
        pdf.mixed_line([
            ("Helvetica", "Punjab  "),
            ("NotoDeva", "पंजाब  "),
            ("NotoGuru", "ਪੰਜਾਬ"),
        ], size=16)

    # Page 7 — colophon (no counted terms)
    pdf.add_page()
    pdf.start_section("Colophon", level=0)
    pdf.heading("Colophon")
    pdf.para("This file exercises search, selection, copying, thumbnails and "
             "bookmarks across three scripts. Rendered with embedded Noto "
             "fonts and HarfBuzz shaping so conjuncts and vowel signs display "
             "exactly as readers expect.")

    out = os.path.join(SAMPLES, "multilingual.pdf")
    pdf.output(out)
    print(f"Created: samples/multilingual.pdf ({pdf.pages_count} pages)")


# ----------------------------------------------------------------------------
# Hindi sample (4 pages)
# ----------------------------------------------------------------------------

def create_hindi():
    pdf = new_doc("Cambuz Hindi Sample")
    pdf.set_subject("Devanagari reading test")
    pdf.set_keywords("Hindi, Devanagari, unicode")

    pdf.add_page()
    pdf.start_section("Cover", level=0)
    pdf.ln(30)
    pdf.heading("नमूना दस्तावेज़", font="NotoDeva")
    pdf.subheading("Cambuz PDF Reader")
    pdf.para("यह चार पृष्ठ का दस्तावेज़ है।", font="NotoDeva")

    pdf.add_page()
    pdf.start_section("Six sentences", level=0)
    pdf.heading("छह उदाहरण", font="NotoDeva")
    for s in HINDI_SENTENCES:
        pdf.para(s, font="NotoDeva")

    pdf.add_page()
    pdf.start_section("Letters and numerals", level=0)
    pdf.heading("अक्षर और अंक", font="NotoDeva")
    pdf.para("अक्षर: क्ष त्र ज्ञ श्र द्ध ह्म", font="NotoDeva")
    pdf.para("उदाहरण: उत्तर राज्य पुस्तक कक्षा", font="NotoDeva")
    pdf.para("उदाहरण: यज्ञ शस्त्र वस्त्र बुद्ध", font="NotoDeva")
    pdf.para("मात्राएँ: का की कु कू के कै को कौ कं कः", font="NotoDeva")
    pdf.para("अंक: ० १ २ ३ ४ ५ ६ ७ ८ ९", font="NotoDeva")
    pdf.para("भारत महान देश है।", font="NotoDeva")

    pdf.add_page()
    pdf.start_section("Mixed page", level=0)
    pdf.heading("English और देवनागरी", font="NotoDeva")
    pdf.mixed_line([("Helvetica", "English and "),
                    ("NotoDeva", "देवनागरी "),
                    ("Helvetica", "on one page.")])
    pdf.mixed_line([("Helvetica", "The river Satluj flows on.")])
    pdf.para("चंडीगढ़ एक सुंदर शहर है।", font="NotoDeva")

    out = os.path.join(SAMPLES, "hindi-sample.pdf")
    pdf.output(out)
    print(f"Created: samples/hindi-sample.pdf ({pdf.pages_count} pages)")


# ----------------------------------------------------------------------------
# Punjabi sample (4 pages)
# ----------------------------------------------------------------------------

def create_punjabi():
    pdf = new_doc("Cambuz Punjabi Sample")
    pdf.set_subject("Gurmukhi reading test")
    pdf.set_keywords("Punjabi, Gurmukhi, unicode")

    pdf.add_page()
    pdf.start_section("Cover", level=0)
    pdf.ln(30)
    pdf.heading("ਨਮੂਨਾ ਦਸਤਾਵੇਜ", font="NotoGuru")
    pdf.subheading("Cambuz PDF Reader")
    pdf.para("ਇਹ ਪਰਖ ਦਸਤਾਵੇਜ ਹੈ।", font="NotoGuru")

    pdf.add_page()
    pdf.start_section("Six sentences", level=0)
    pdf.heading("ਛੇ ਉਦਾਹਰਨ", font="NotoGuru")
    for s in PUNJABI_SENTENCES:
        pdf.para(s, font="NotoGuru")

    pdf.add_page()
    pdf.start_section("Letters and numerals", level=0)
    pdf.heading("ਲਗਾਂ ਅਤੇ ਅੰਕ", font="NotoGuru")
    pdf.para("ਲਗਾਂ: ਕਾ ਕੀ ਕੁ ਕੂ ਕੇ ਕੈ ਕੋ ਕੌ ਕੰ ਕੱ", font="NotoGuru")
    pdf.para("ਉਦਾਹਰਨ: ਪੁੱਤਰ ਸਕੂਲ ਕੁੜੀ", font="NotoGuru")
    pdf.para("ਉਦਾਹਰਨ: ਰੁੱਖ ਮੱਖਣ ਦੁੱਧ", font="NotoGuru")
    pdf.para("ਅੰਕ: ੦ ੧ ੨ ੩ ੪ ੫ ੬ ੭ ੮ ੯", font="NotoGuru")
    pdf.para("ਸੂਬਾ ਸੁੰਦਰ ਹੈ।", font="NotoGuru")

    pdf.add_page()
    pdf.start_section("Mixed page", level=0)
    pdf.mixed_line([("Helvetica", "English "),
                    ("NotoGuru", "ਅਤੇ "),
                    ("Helvetica", "Gurmukhi")], size=22)
    pdf.mixed_line([("Helvetica", "English and Gurmukhi on one page.")])
    pdf.mixed_line([("Helvetica", "The river Satluj flows on.")])
    pdf.para("ਚੰਡੀਗੜ੍ਹ ਇੱਕ ਸੁੰਦਰ ਨਗਰ ਹੈ।", font="NotoGuru")

    out = os.path.join(SAMPLES, "punjabi-sample.pdf")
    pdf.output(out)
    print(f"Created: samples/punjabi-sample.pdf ({pdf.pages_count} pages)")


def main():
    print("Generating Unicode sample PDFs...")
    create_multilingual()
    create_hindi()
    create_punjabi()
    print("Done!")


if __name__ == "__main__":
    main()
