declare module '@point-of-sale/receipt-printer-encoder' {
  interface EncoderOptions {
    language?: 'esc-pos' | 'star-prnt' | 'star-line';
    /** Number of columns (characters per line). Alias: width */
    columns?: number;
    /** Backwards-compat alias for columns */
    width?: number;
    imageMode?: 'column' | 'raster';
    feedBeforeCut?: number;
    codepageMapping?: string;
    errors?: 'strict' | 'relaxed';
    printerModel?: string;
  }

  class ReceiptPrinterEncoder {
    constructor(options?: EncoderOptions);

    /** Send printer-initialize commands */
    initialize(): this;

    /** Set active codepage */
    codepage(value: string): this;

    /** Add inline text (no newline) */
    text(value: string): this;

    /** Add a newline (or n newlines) */
    newline(count?: number): this;

    /** Add a line of text followed by a newline */
    line(value: string): this;

    /** Set text alignment */
    align(value: 'left' | 'center' | 'right'): this;

    /** Toggle bold */
    bold(enabled: boolean): this;

    /** Toggle italic */
    italic(enabled: boolean): this;

    /** Toggle underline */
    underline(enabled: boolean): this;

    /** Set character size multiplier (1–8) */
    size(width: number, height: number): this;

    /** Toggle inverted (white-on-black) */
    invert(enabled: boolean): this;

    /** Print a QR code */
    qrcode(
      value: string,
      model?: number | string,
      size?: number,
      errorlevel?: 'l' | 'm' | 'q' | 'h',
    ): this;

    /** Print a barcode */
    barcode(value: string, symbology: string, options?: object): this;

    /** Print a horizontal rule */
    rule(options?: { style?: 'single' | 'double'; width?: number }): this;

    /** Emit a cut command */
    cut(type?: 'partial' | 'full'): this;

    /** Inject raw bytes */
    raw(data: number[] | Uint8Array): this;

    /** Flush and encode to Uint8Array */
    encode(): Uint8Array;
  }

  export default ReceiptPrinterEncoder;
}
