/**
 * Browser (window.print) fallback transport.
 * Opens a new window with the provided HTML, triggers the system print dialog,
 * then closes the window.  Works everywhere — no driver or USB needed.
 */

function buildPrintCSS(paperWidth: 58 | 80 = 80): string {
  const pageW    = `${paperWidth}mm`;
  const bodyW    = paperWidth === 58 ? '54mm' : '76mm';
  const fontSize = paperWidth === 58 ? '11px' : '12px';
  return `
  @page { size: ${pageW} auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: 'IBM Plex Sans Thai', 'TH Sarabun New', sans-serif;
    font-size: ${fontSize};
    width: ${bodyW};
    padding: 2mm;
    margin: 0;
    color: #000;
  }
  .center { text-align: center; }
  .right  { text-align: right; }
  .bold   { font-weight: bold; }
  .big    { font-size: 20px; font-weight: bold; }
  .xl     { font-size: 28px; font-weight: bold; }
  .row {
    display: flex;
    justify-content: space-between;
    white-space: nowrap;
  }
  .row .name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    margin-right: 4px;
  }
  .row .value { flex-shrink: 0; }
  hr {
    border: none;
    border-top: 1px dashed #000;
    margin: 3px 0;
  }
  .qr-wrap { text-align: center; margin: 6px 0; }
  .qr-wrap img { width: 120px; height: 120px; }
  .logo-wrap { text-align: center; margin: 4px 0 6px; }
  .logo-wrap .logo { max-height: 48px; max-width: 100%; object-fit: contain; }
  .small { font-size: 10px; }
  .item-row {
    display: flex;
    justify-content: space-between;
    gap: 4px;
  }
  .item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .item-qty  { width: 24px; text-align: center; flex-shrink: 0; }
  .item-total{ width: 52px; text-align: right; flex-shrink: 0; tabular-nums: initial; }
`;
}

/** @deprecated Use printBrowser with explicit paperWidth instead */
export const PRINT_CSS = buildPrintCSS(80);

export function printBrowser(html: string, paperWidth: 58 | 80 = 80): void {
  const win = window.open('', '_blank', 'width=420,height=700');
  if (!win) {
    throw new Error(
      'ไม่สามารถเปิดหน้าต่างพิมพ์ได้ กรุณาอนุญาต popup ในเบราว์เซอร์',
    );
  }

  win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>พิมพ์</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500&display=swap" rel="stylesheet" />
  <style>${buildPrintCSS(paperWidth)}</style>
</head>
<body>${html}</body>
</html>`);
  win.document.close();

  // Wait for fonts to load before triggering print dialog
  const trigger = () => { win.print(); win.close(); };
  if (win.document.fonts?.ready) {
    win.document.fonts.ready.then(trigger);
  } else {
    setTimeout(trigger, 800);
  }
}

