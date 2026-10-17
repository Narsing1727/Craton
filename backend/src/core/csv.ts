// A small RFC 4180 CSV reader: quoted fields, doubled quotes, commas and newlines inside quotes,
// CRLF or LF, a leading byte-order mark. Returns rows of strings; never throws on odd input (a
// stray quote just ends up in the field), because a table that merely looks wrong should still
// open and diff.

export function parseCsv(input: string, delimiter = ","): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let sawAny = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      sawAny = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
      sawAny = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      // A blank line is not a row.
      if (!(row.length === 1 && row[0] === "" && !sawAny)) rows.push(row);
      row = [];
      field = "";
      sawAny = false;
    } else {
      field += ch;
      sawAny = true;
    }
  }
  if (field !== "" || row.length > 0 || sawAny) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Guess the delimiter from the header line: whichever of , ; tab | appears most outside quotes. */
export function sniffDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",", bestCount = 0;
  for (const d of [",", ";", "\t", "|"]) {
    let count = 0, quoted = false;
    for (const ch of header) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}
