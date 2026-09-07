export const parseDate = (date: string): Date => {
  let dateObj = new Date(date);
  if (isNaN(dateObj.getTime())) {
    dateObj = new Date(parseInt(date));
  }
  return dateObj;
};

const sessionDateOptions: Intl.DateTimeFormatOptions = {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

export const formatSessionDate = (date: Date, compact = false): string => {
  return date.toLocaleString(undefined, {
    ...sessionDateOptions,
    year: compact ? "2-digit" : "numeric",
  });
}; 