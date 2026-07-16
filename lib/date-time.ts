const BANGKOK_TIME_ZONE = 'Asia/Bangkok';
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY_PATTERN = /^(\d{2}):(\d{2})/;

export type DateTimeValue = Date | string | number | null | undefined;

function toDate(value: DateTimeValue): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const dateOnly = DATE_ONLY_PATTERN.exec(value);
    if (dateOnly) {
      const [, year, month, day] = dateOnly;
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function gregorianDateParts(value: DateTimeValue) {
  const date = toDate(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const day = part('day');
  const month = part('month');
  const year = part('year');
  if (!day || !month || !year) return null;
  return { day, month, buddhistYear: String(Number(year) + 543) };
}

export function formatThaiDate(value: DateTimeValue, fallback = '-'): string {
  const parts = gregorianDateParts(value);
  return parts ? `${parts.day}/${parts.month}/${parts.buddhistYear}` : fallback;
}

export function formatThaiLongDate(value: DateTimeValue, fallback = '-'): string {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist-nu-latn', {
    timeZone: BANGKOK_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatThaiShortDate(value: DateTimeValue, fallback = '-'): string {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist-nu-latn', {
    timeZone: BANGKOK_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatThaiMonthDay(value: DateTimeValue, fallback = '-'): string {
  const parts = gregorianDateParts(value);
  return parts ? `${parts.day}/${parts.month}` : fallback;
}

export function formatThaiTime(value: DateTimeValue, fallback = '-'): string {
  if (typeof value === 'string') {
    const timeOnly = TIME_ONLY_PATTERN.exec(value);
    if (timeOnly) return `${timeOnly[1]}:${timeOnly[2]}`;
  }
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatThaiDateTime(value: DateTimeValue, fallback = '-'): string {
  const dateText = formatThaiDate(value, '');
  const timeText = formatThaiTime(value, '');
  return dateText && timeText ? `${dateText} ${timeText}` : fallback;
}

export function formatThaiDateRange(
  start: DateTimeValue,
  end: DateTimeValue,
  separator = ' ถึง ',
  fallback = '-',
): string {
  const startText = formatThaiDate(start, '');
  const endText = formatThaiDate(end, '');
  return startText && endText ? `${startText}${separator}${endText}` : fallback;
}

export function formatThaiShortDateRange(
  start: DateTimeValue,
  end: DateTimeValue,
  separator = ' ถึง ',
  fallback = '-',
): string {
  const startText = formatThaiShortDate(start, '');
  const endText = formatThaiShortDate(end, '');
  return startText && endText ? `${startText}${separator}${endText}` : fallback;
}
