/**
 * 本地时间格式化工具，默认使用用户所在时区
 */
const TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (locale: string) => {
  const cached = formatterCache.get(locale);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locale, TIME_FORMAT_OPTIONS);
  formatterCache.set(locale, formatter);
  return formatter;
};

type SupportedInput = string | number | Date;

export function formatLocalTime(
  value: SupportedInput,
  locale = "zh-CN"
): string {
  if (value === null || value === undefined) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return getFormatter(locale).format(date);
}
