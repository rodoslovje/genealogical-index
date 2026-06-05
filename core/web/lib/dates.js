const MONTH_NAMES_EN = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// Maps all supported month spellings (EN/IT/SL, full and abbreviated) to 1-based month index
const MONTH_MAP = {
  january:1,  february:2,  march:3,    april:4,    may:5,      june:6,
  july:7,     august:8,    september:9, october:10, november:11, december:12,
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  januar:1,   februar:2,   marec:3,    maj:5,      junij:6,    julij:7,
  avgust:8,   avg:8,       oktober:10, okt:10,
  siječanj:1, veljača:2,   vel:2,      ožujak:3,   ožu:3,      travanj:4,   tra:4,
  svibanj:5,  svi:5,       lipanj:6,   lip:6,      srpanj:7,   srp:7,
  kolovoz:8,  kol:8,       rujan:9,    ruj:9,      listopad:10,lis:10,
  studeni:11, stu:11,      prosinac:12,pro:12,
  märz:3,     mär:3,       mai:5,      juni:6,     juli:7,
  dezember:12, dez:12,
  január:1,   február:2,   március:3,  márc:3,     már:3,      április:4,   ápr:4,
  május:5,    máj:5,       június:6,   jún:6,      július:7,   júl:7,
  augusztus:8, szeptember:9, szept:9,  október:10,
  gennaio:1,  febbraio:2,  marzo:3,    aprile:4,   maggio:5,   giugno:6,
  luglio:7,   agosto:8,    settembre:9, ott:10,    dicembre:12,
  gen:1, mag:5, giu:6, lug:7, ago:8, set:9, dic:12,
};

const MON_RE = '[A-Za-zčšžČŠŽäöüÄÖÜáéíóőúűÁÉÍÓŐÚŰ]+';

export function normalizeSearchDate(val) {
  if (!val) return val;
  const str = val.trim();

  const dotMatch = str.match(/^(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})$/);
  if (dotMatch) {
    const m = parseInt(dotMatch[2], 10);
    if (m >= 1 && m <= 12) return `${parseInt(dotMatch[1], 10)} ${MONTH_NAMES_EN[m - 1]} ${dotMatch[3]}`;
  }

  const slashMatch = str.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if (slashMatch) {
    const m = parseInt(slashMatch[1], 10);
    if (m >= 1 && m <= 12) return `${parseInt(slashMatch[2], 10)} ${MONTH_NAMES_EN[m - 1]} ${slashMatch[3]}`;
  }

  const wordMatch = str.match(new RegExp(`^(\\d{1,2})\\s+(${MON_RE})\\s+(\\d{4})$`));
  if (wordMatch) {
    const m = MONTH_MAP[wordMatch[2].toLowerCase()];
    if (m) return `${parseInt(wordMatch[1], 10)} ${MONTH_NAMES_EN[m - 1]} ${wordMatch[3]}`;
  }

  const monDotYearMatch = str.match(new RegExp(`^(\\d{1,2}|${MON_RE})\\s*\\.\\s*(\\d{4})$`));
  if (monDotYearMatch) {
    const raw = monDotYearMatch[1];
    const year = monDotYearMatch[2];
    const m = /^\d+$/.test(raw) ? parseInt(raw, 10) : MONTH_MAP[raw.toLowerCase()];
    if (m >= 1 && m <= 12) return `${MONTH_NAMES_EN[m - 1]} ${year}`;
  }

  const monSlashYearMatch = str.match(new RegExp(`^(\\d{1,2}|${MON_RE})\\s*\\/\\s*(\\d{4})$`));
  if (monSlashYearMatch) {
    const raw = monSlashYearMatch[1];
    const year = monSlashYearMatch[2];
    const m = /^\d+$/.test(raw) ? parseInt(raw, 10) : MONTH_MAP[raw.toLowerCase()];
    if (m >= 1 && m <= 12) return `${MONTH_NAMES_EN[m - 1]} ${year}`;
  }

  const monSpaceYearMatch = str.match(new RegExp(`^(${MON_RE})\\s+(\\d{4})$`));
  if (monSpaceYearMatch) {
    const m = MONTH_MAP[monSpaceYearMatch[1].toLowerCase()];
    if (m) return `${MONTH_NAMES_EN[m - 1]} ${monSpaceYearMatch[2]}`;
  }

  const isoFullMatch = str.match(/^(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (isoFullMatch) {
    const m = parseInt(isoFullMatch[2], 10);
    if (m >= 1 && m <= 12) return `${parseInt(isoFullMatch[3], 10)} ${MONTH_NAMES_EN[m - 1]} ${isoFullMatch[1]}`;
  }

  const isoMonthMatch = str.match(/^(\d{4})\s*-\s*(\d{1,2})$/);
  if (isoMonthMatch) {
    const m = parseInt(isoMonthMatch[2], 10);
    if (m >= 1 && m <= 12) return `${MONTH_NAMES_EN[m - 1]} ${isoMonthMatch[1]}`;
  }

  return str;
}

export function parseDateForSort(dateStr) {
  if (!dateStr) return 0;
  let str = String(dateStr).toLowerCase();
  str = str.replace(/(abt\.?|about|bef\.?|before|aft\.?|after|cal|est\.?)\s*/g, '').trim();
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  let year = 0, month = 0, day = 0;
  const yearMatch = str.match(/\b(\d{4})\b/);
  if (yearMatch) year = parseInt(yearMatch[1], 10);
  const monthMatch = str.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/);
  if (monthMatch) month = months[monthMatch[1]];
  const parts = str.split(/[\s\-.\/]+/);
  for (const part of parts) {
    if (/^\d{1,2}$/.test(part) && parseInt(part, 10) <= 31) { day = parseInt(part, 10); break; }
  }
  return year * 10000 + month * 100 + day;
}

export function childYearOf(p) {
  if (!p) return '';
  if (p.date_of_birth) {
    const m = String(p.date_of_birth).match(/\d{4}/);
    if (m) return m[0];
  }
  return p.year || '';
}