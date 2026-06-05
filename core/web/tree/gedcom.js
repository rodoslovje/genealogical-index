import { t } from '../i18n.js';
import { downloadBlob, formatExportFilename } from '../lib/utils.js';

// GEDCOM (.ged) export for both trees. Re-exported via tree/shared.js.
// d3 is loaded globally from the CDN.

// --- GEDCOM (.ged) export ---------------------------------------------------
// The per-tree builders return a model of { individuals, families } using the
// shapes below; `serializeGedcom` turns that into a GEDCOM 5.5.1 file.
//   individual: { id, name, surname, altSurname, sex, birth:{date,place},
//                 baptism:{date,place}, death:{date,place}, notes, links:[url],
//                 fams:[famId], famc:famId|null }
//   family:     { id, husband:indiId|null, wife:indiId|null, children:[indiId], marriage:{date,place}|null }
// Dates are passed through verbatim (the index stores free-form date strings),
// which GEDCOM readers tolerate in DATE values.

const GED_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function gedHeaderDate(d) {
  return `${String(d.getDate()).padStart(2, '0')} ${GED_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// `@` begins a pointer/escape in GEDCOM, so a literal `@` in a free-text value
// must be doubled. URLs built from GEDCOM-style xref ids routinely contain one.
function gedEscape(value) {
  return String(value).replace(/@/g, '@@');
}

// Emits a multi-line GEDCOM value as the given tag followed by CONT lines, so
// embedded newlines survive (single-line values just produce one line).
function gedTextLines(level, tag, value) {
  const parts = gedEscape(value).split(/\r?\n/);
  const out = [`${level} ${tag} ${parts[0]}`];
  for (let i = 1; i < parts.length; i++) out.push(`${level + 1} CONT ${parts[i]}`);
  return out;
}

// Emits an event block (BIRT/BAPM/DEAT) with optional DATE/PLAC, or nothing
// when the event has neither.
function gedEventLines(tag, event) {
  if (!event || (!event.date && !event.place)) return [];
  const out = [`1 ${tag}`];
  if (event.date) out.push(`2 DATE ${gedEscape(event.date)}`);
  if (event.place) out.push(`2 PLAC ${gedEscape(event.place)}`);
  return out;
}

// `source` describes where the tree came from: { contributorName, url }. It
// becomes a citable SOURCE record (the index as title, the genealogist as
// author, the tree's page URL) referenced from the header and every individual.
function serializeGedcom({ individuals, families }, source = {}) {
  const lines = [];
  const sysId = 'GenealogicalIndex';
  const submId = 'SUBM1';
  const srcId = 'SRC1';

  lines.push('0 HEAD');
  lines.push(`1 SOUR ${sysId}`);
  lines.push(`2 NAME ${gedEscape(t('site_title'))}`);
  lines.push(`2 CORP ${gedEscape(window.location.hostname)}`);
  lines.push(`1 DATE ${gedHeaderDate(new Date())}`);
  lines.push('1 GEDC');
  lines.push('2 VERS 5.5.1');
  lines.push('2 FORM LINEAGE-LINKED');
  lines.push('1 CHAR UTF-8');
  lines.push(`1 SUBM @${submId}@`);

  lines.push(`0 @${submId}@ SUBM`);
  lines.push(`1 NAME ${gedEscape(t('site_title'))}`);

  // SOURCE record: the index, the contributing genealogist, and the deep link
  // back to this ancestors/descendants view.
  lines.push(`0 @${srcId}@ SOUR`);
  lines.push(`1 TITL ${gedEscape(t('site_title'))}`);
  if (source.contributorName) lines.push(`1 AUTH ${gedEscape(source.contributorName)}`);
  if (source.url) {
    lines.push(`1 PUBL ${gedEscape(window.location.origin)}`);
    lines.push(...gedTextLines(1, 'NOTE', source.url));
  }

  for (const indi of individuals) {
    lines.push(`0 @${indi.id}@ INDI`);
    if (indi.name || indi.surname) {
      lines.push(`1 NAME ${`${gedEscape(indi.name).trim()} /${gedEscape(indi.surname).trim()}/`.trim()}`);
    }
    // Alternative surname as a second, "aka"-typed NAME structure.
    if (indi.altSurname) {
      lines.push(`1 NAME ${`${gedEscape(indi.name).trim()} /${gedEscape(indi.altSurname).trim()}/`.trim()}`);
      lines.push('2 TYPE aka');
    }
    if (indi.sex === 'm') lines.push('1 SEX M');
    else if (indi.sex === 'f') lines.push('1 SEX F');
    lines.push(...gedEventLines('BIRT', indi.birth));
    lines.push(...gedEventLines('BAPM', indi.baptism));
    lines.push(...gedEventLines('DEAT', indi.death));
    if (indi.notes) lines.push(...gedTextLines(1, 'NOTE', indi.notes));
    // Source links as multimedia objects pointing at the external URL.
    for (const url of indi.links || []) {
      lines.push('1 OBJE');
      lines.push(`2 FILE ${gedEscape(url)}`);
      lines.push('3 FORM html');
    }
    lines.push(`1 SOUR @${srcId}@`);
    for (const f of indi.fams) lines.push(`1 FAMS @${f}@`);
    if (indi.famc) lines.push(`1 FAMC @${indi.famc}@`);
  }

  for (const fam of families) {
    lines.push(`0 @${fam.id}@ FAM`);
    if (fam.husband) lines.push(`1 HUSB @${fam.husband}@`);
    if (fam.wife) lines.push(`1 WIFE @${fam.wife}@`);
    for (const c of fam.children) lines.push(`1 CHIL @${c}@`);
    if (fam.marriage && (fam.marriage.date || fam.marriage.place)) {
      lines.push('1 MARR');
      if (fam.marriage.date) lines.push(`2 DATE ${gedEscape(fam.marriage.date)}`);
      if (fam.marriage.place) lines.push(`2 PLAC ${gedEscape(fam.marriage.place)}`);
    }
  }

  lines.push('0 TRLR');
  return lines.join('\n') + '\n';
}

// Factory the per-tree builders use to allocate sequentially-numbered records.
export function createGedcomModel() {
  const individuals = [];
  const families = [];
  let iSeq = 0;
  let fSeq = 0;
  return {
    individuals,
    families,
    // person: a tree person/partner dict (some fields may be absent).
    addIndividual(person) {
      const indi = {
        id: `I${++iSeq}`,
        name: person?.name || '',
        surname: person?.surname || '',
        altSurname: person?.alt_surname || '',
        sex: person?.sex || '',
        birth: { date: person?.date_of_birth || '', place: person?.place_of_birth || '' },
        baptism: { date: person?.date_of_baptism || '', place: person?.place_of_baptism || '' },
        death: { date: person?.date_of_death || '', place: person?.place_of_death || '' },
        notes: person?.notes || '',
        links: Array.isArray(person?.links) ? person.links : [],
        fams: [],
        famc: null,
      };
      individuals.push(indi);
      return indi;
    },
    // Links a husband/wife (either may be null) and returns the new family.
    addFamily(husband, wife, marriage) {
      const fam = {
        id: `F${++fSeq}`,
        husband: husband ? husband.id : null,
        wife: wife ? wife.id : null,
        children: [],
        marriage: marriage || null,
      };
      families.push(fam);
      if (husband) husband.fams.push(fam.id);
      if (wife) wife.fams.push(fam.id);
      return fam;
    },
  };
}

// Wires the GEDCOM-download button. `buildModel()` returns { individuals, families }.
export function attachGedExport({ downloadBtnId, buildModel, personName, contributorName, filePrefix }) {
  const btn = document.getElementById(downloadBtnId);
  if (!btn) return;
  d3.select(`#${downloadBtnId}`).on('click', null).on('click', () => {
    const ged = serializeGedcom(buildModel(), {
      contributorName,
      url: window.location.href,
    });
    const filename = formatExportFilename(`${filePrefix}-${personName || filePrefix}`, 'ged');
    downloadBlob(new Blob([ged], { type: 'text/plain;charset=utf-8;' }), filename);
  });
}
