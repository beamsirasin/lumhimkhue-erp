/**
 * Browser (window.print) fallback transport.
 * Opens a new window with the provided HTML, triggers the system print dialog,
 * then closes the window.  Works everywhere — no driver or USB needed.
 */

/** CSS shared by all print templates */
const PRINT_CSS = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: 'IBM Plex Sans Thai', 'TH Sarabun New', sans-serif;
    font-size: 12px;
    width: 76mm;
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

export function printBrowser(html: string): void {
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
  <style>${PRINT_CSS}</style>
</head>
<body>${html}</body>
</html>`);
  win.document.close();

  // Small delay to let fonts + images load before the print dialog
  setTimeout(() => {
    win.print();
    win.close();
  }, 400);
}

/** Expose the CSS so HTML templates can reuse the same class names */
export { PRINT_CSS };
