#!/usr/bin/env node
// Cambuz PDF Reader — Sample PDF Generator
// Creates sample PDF files for testing

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const samplesDir = path.join(__dirname, '..', 'samples');
if (!fs.existsSync(samplesDir)) {
  fs.mkdirSync(samplesDir, { recursive: true });
}

async function createWelcomePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const pages = [
    { title: 'Cambuz PDF Reader', subtitle: 'Welcome to Phase 1', body: 'This is a sample PDF document to test the Cambuz PDF Reader. It contains multiple pages to verify navigation, zoom, and rendering features work correctly.' },
    { title: 'Page Navigation', subtitle: 'Test Features', body: 'Use the Previous/Next buttons or PageUp/PageDown keys to navigate between pages. You can also type a page number and press Enter to jump directly.' },
    { title: 'Zoom Controls', subtitle: 'Magnification', body: 'Use Ctrl+Plus to zoom in and Ctrl+Minus to zoom out. Ctrl+0 fits the page, and Ctrl+Shift+0 fits the width. You can also use Ctrl+mouse wheel.' },
    { title: 'Drag & Drop', subtitle: 'File Opening', body: 'You can open PDF files by clicking the Open button, using Ctrl+O, or by dragging and dropping a PDF file onto the window.' },
    { title: 'Theme Toggle', subtitle: 'Dark & Light Mode', body: 'Press Ctrl+Shift+D or click the theme button to switch between dark and light themes. The interface adapts automatically.' },
  ];

  for (let i = 0; i < pages.length; i++) {
    const page = doc.addPage([612, 792]);
    const { title, subtitle, body } = pages[i];

    page.drawText(title, { x: 50, y: 720, font: boldFont, size: 28, color: rgb(0.12, 0.16, 0.24) });
    page.drawText(subtitle, { x: 50, y: 680, font, size: 18, color: rgb(0.3, 0.4, 0.6) });
    page.drawRectangle({ x: 50, y: 665, width: 512, height: 2, color: rgb(0.8, 0.85, 0.9) });

    const words = body.split(' ');
    let line = '';
    let y = 630;
    for (const word of words) {
      const test = line + (line ? ' ' : '') + word;
      if (font.widthOfTextAtSize(test, 13) > 500 && line) {
        page.drawText(line, { x: 50, y, font, size: 13, color: rgb(0.2, 0.2, 0.2) });
        line = word;
        y -= 20;
      } else {
        line = test;
      }
    }
    if (line) page.drawText(line, { x: 50, y, font, size: 13, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(`Page ${i + 1} of ${pages.length}`, { x: 250, y: 40, font, size: 11, color: rgb(0.5, 0.5, 0.5) });
  }

  const bytes = await doc.save();
  fs.writeFileSync(path.join(samplesDir, 'welcome.pdf'), bytes);
  console.log('Created: samples/welcome.pdf (5 pages)');
}

async function createDemoPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await doc.embedFont(StandardFonts.HelveticaOblique);

  const topics = [
    { title: 'Cambuz PDF Reader', subtitle: 'Phase 1 — Working PDF Reader', body: 'Welcome to Cambuz, a lightweight PDF reader built for speed and simplicity. This sample document demonstrates multi-page navigation, zoom controls, and clean rendering.' },
    { title: 'Navigation', subtitle: 'Moving Through Pages', body: 'Use the Previous and Next buttons in the toolbar, or press PageUp and PageDown on your keyboard. You can also type a page number directly into the page input field and press Enter to jump to any page.' },
    { title: 'Zoom Controls', subtitle: 'Adjusting Magnification', body: 'Click the Zoom In and Zoom Out buttons, or use Ctrl+Plus and Ctrl+Minus. Ctrl+0 fits the entire page in view. Ctrl+Shift+0 fits the page width. You can also hold Ctrl and scroll the mouse wheel.' },
    { title: 'File Operations', subtitle: 'Opening and Closing', body: 'Click the Open button or press Ctrl+O to open a PDF from your computer. You can also drag and drop a PDF file onto the application window. Click Close or press Ctrl+W to close the current document.' },
    { title: 'Theme Support', subtitle: 'Dark and Light Modes', body: 'Press Ctrl+Shift+D or click the theme button in the toolbar to toggle between dark and light themes. The interface adapts automatically to your preference.' },
    { title: 'Keyboard Shortcuts', subtitle: 'Quick Reference', body: 'Ctrl+O: Open file. Ctrl+W: Close file. PageUp/PageDown: Navigate pages. Home/End: First/last page. Ctrl+Plus/Minus: Zoom in/out. Ctrl+0: Fit page. Ctrl+Shift+0: Fit width.' },
    { title: 'PDF Rendering', subtitle: 'Powered by PDF.js', body: 'Cambuz uses Mozilla PDF.js, a battle-tested PDF rendering engine. It supports complex layouts, embedded fonts, vector graphics, and Unicode text including Indian languages.' },
    { title: 'Architecture', subtitle: 'Clean and Modular', body: 'The application separates rendering, text extraction, and printing into independent modules. This makes it easier to maintain, test, and extend with future features.' },
    { title: 'Performance', subtitle: 'Lightweight by Design', body: 'Cambuz is designed to be fast and responsive. It loads quickly, renders pages efficiently, and uses minimal system resources compared to larger PDF suites.' },
    { title: 'Future Phases', subtitle: 'What Comes Next', body: 'Phase 2 adds search, thumbnails, and bookmarks. Phase 3 adds printing. Phase 4 adds basic PDF utilities. Each phase builds on the previous one while keeping the application lightweight.' },
  ];

  for (let i = 0; i < topics.length; i++) {
    const page = doc.addPage([612, 792]);
    const { title, subtitle, body } = topics[i];

    page.drawRectangle({ x: 0, y: 740, width: 612, height: 52, color: rgb(0.12, 0.16, 0.24) });
    page.drawText(title, { x: 50, y: 758, font: boldFont, size: 22, color: rgb(1, 1, 1) });
    page.drawText(subtitle, { x: 50, y: 710, font: italicFont, size: 14, color: rgb(0.3, 0.4, 0.6) });
    page.drawRectangle({ x: 50, y: 695, width: 512, height: 1, color: rgb(0.8, 0.85, 0.9) });

    const words = body.split(' ');
    let line = '';
    let y = 660;
    for (const word of words) {
      const test = line + (line ? ' ' : '') + word;
      if (font.widthOfTextAtSize(test, 13) > 500 && line) {
        page.drawText(line, { x: 50, y, font, size: 13, color: rgb(0.2, 0.2, 0.2) });
        line = word;
        y -= 22;
      } else {
        line = test;
      }
    }
    if (line) page.drawText(line, { x: 50, y, font, size: 13, color: rgb(0.2, 0.2, 0.2) });

    const boxY = 200;
    page.drawRectangle({ x: 50, y: boxY, width: 512, height: 100, color: rgb(0.95, 0.96, 0.98), borderColor: rgb(0.8, 0.85, 0.9), borderWidth: 1 });
    page.drawText('Cambuz PDF Reader', { x: 180, y: boxY + 60, font: boldFont, size: 16, color: rgb(0.12, 0.16, 0.24) });
    page.drawText('Read. Search. Print. Done.', { x: 175, y: boxY + 30, font: italicFont, size: 12, color: rgb(0.4, 0.5, 0.7) });

    page.drawRectangle({ x: 0, y: 0, width: 612, height: 30, color: rgb(0.95, 0.96, 0.98) });
    page.drawText(`Page ${i + 1} of ${topics.length}`, { x: 260, y: 10, font, size: 10, color: rgb(0.5, 0.5, 0.5) });
  }

  const bytes = await doc.save();
  fs.writeFileSync(path.join(samplesDir, 'cambuz-demo.pdf'), bytes);
  console.log(`Created: samples/cambuz-demo.pdf (${topics.length} pages)`);
}

async function main() {
  console.log('Generating sample PDFs...');
  await createWelcomePdf();
  await createDemoPdf();
  console.log('Done!');
}

main().catch(console.error);