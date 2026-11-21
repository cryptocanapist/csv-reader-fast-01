// Fast drop-in for make.fun's csv-reader 1.0.0.
//
// Same answer as csv-reader 1.0.0's readCsv for every input {text, header}:
// {columns, rows, errors}. The reference reads one character at a time and
// builds every field by string concatenation; this version keeps that exact
// broken-row policy but jumps with native indexOf / split instead.
//
// Policy (from the reference, kept exactly):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with a quote runs to the next non-doubled quote; "" is
//   one quote; CRLF / lone CR inside quotes each become LF. What follows the
//   closing quote up to the next comma or line break is appended as-is
//   (quote_junk when the field ends). A quote that never closes is a literal
//   character and the text after it is read again as unquoted
//   (unterminated_quote). A quote inside an unquoted field is literal.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows are the
//   records after it (every record when header is false), each padded with ""
//   (short_row, with fields: its field count) or cut (long_row, with extra:
//   the cut fields) to the first record's width.
// - Each error is {code, line, row}, in the order met; a record's short_row
//   or long_row when it ends. line is the 1-based line its record starts on,
//   counting every LF, CRLF and lone CR inside quotes; row is its record's
//   index in rows, null for the header.

const COMMA = 44; // ','
const QUOTE = 34; // '"'
const CR = 13;
const LF = 10;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // Record currently being read: the line it starts on and its index in
  // rows (null for the header). Closures below read these as they stand.
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field starting at pos, onto `init` (the value built
  // so far: '' for a plain field, the quoted value for quote junk, '"' for
  // an unterminated quote re-read as unquoted). Returns {value, ended,
  // added} where ended is 'comma' | 'line' | 'end' and added counts the
  // characters this call kept (junk is an error only when added > 0).
  function readUnquoted(init) {
    let parts = null;
    let added = 0;
    let start = pos;
    while (pos < len) {
      const iC = text.indexOf(',', pos);
      const iN = text.indexOf('\n', pos);
      const iR = text.indexOf('\r', pos);
      let nxt = len;
      let kind = 0;
      if (iC !== -1 && iC < nxt) { nxt = iC; kind = COMMA; }
      if (iN !== -1 && iN < nxt) { nxt = iN; kind = LF; }
      if (iR !== -1 && iR < nxt) { nxt = iR; kind = CR; }
      if (kind === 0) {
        const chunk = text.slice(start, len);
        added += chunk.length;
        pos = len;
        if (parts === null) return { value: init + chunk, ended: 'end', added };
        parts.push(chunk);
        return { value: init + parts.join(''), ended: 'end', added };
      }
      if (kind === COMMA) {
        const chunk = text.slice(start, nxt);
        added += chunk.length;
        pos = nxt + 1;
        if (parts === null) return { value: init + chunk, ended: 'comma', added };
        parts.push(chunk);
        return { value: init + parts.join(''), ended: 'comma', added };
      }
      if (kind === LF) {
        const chunk = text.slice(start, nxt);
        added += chunk.length;
        pos = nxt + 1;
        line += 1;
        if (parts === null) return { value: init + chunk, ended: 'line', added };
        parts.push(chunk);
        return { value: init + parts.join(''), ended: 'line', added };
      }
      // kind === CR
      if (text.charCodeAt(nxt + 1) === LF) {
        const chunk = text.slice(start, nxt);
        added += chunk.length;
        pos = nxt + 2;
        line += 1;
        if (parts === null) return { value: init + chunk, ended: 'line', added };
        parts.push(chunk);
        return { value: init + parts.join(''), ended: 'line', added };
      }
      // Stray CR outside quotes: dropped, error, keep reading.
      const chunk = text.slice(start, nxt);
      added += chunk.length;
      if (parts === null) parts = [];
      parts.push(chunk);
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = nxt + 1;
      start = pos;
    }
    // Reached the end after dropping stray CRs: the chunks kept before
    // them are the value (a chunk after the last stray CR, if any, was
    // already pushed as a part or is empty at the end).
    if (parts === null) return { value: init, ended: 'end', added };
    return { value: init + parts.join(''), ended: 'end', added };
  }

  // Reads one field that opens with a quote at pos. Returns
  // {value, ended} with ended 'comma' | 'line' | 'end'.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let parts = null;
    let valStart = pos;
    let closed = false;
    let value = '';
    while (pos < len) {
      const iQ = text.indexOf('"', pos);
      const iR = text.indexOf('\r', pos);
      const iN = text.indexOf('\n', pos);
      let nxt = len;
      let kind = 0;
      if (iQ !== -1 && iQ < nxt) { nxt = iQ; kind = QUOTE; }
      if (iR !== -1 && iR < nxt) { nxt = iR; kind = CR; }
      if (iN !== -1 && iN < nxt) { nxt = iN; kind = LF; }
      if (kind === 0) break; // no closing quote left: unterminated
      if (kind === QUOTE) {
        if (text.charCodeAt(nxt + 1) === QUOTE) {
          // Doubled quote: one quote in the value, keep reading.
          if (parts === null) parts = [];
          parts.push(text.slice(valStart, nxt + 1));
          pos = nxt + 2;
          valStart = pos;
          continue;
        }
        // Closing quote.
        if (parts === null) value = text.slice(valStart, nxt);
        else {
          parts.push(text.slice(valStart, nxt));
          value = parts.join('');
        }
        pos = nxt + 1;
        closed = true;
        break;
      }
      // CR or LF inside quotes: one LF in the value, one line counted.
      if (parts === null) parts = [];
      parts.push(text.slice(valStart, nxt));
      parts.push('\n');
      line += 1;
      if (kind === CR && text.charCodeAt(nxt + 1) === LF) pos = nxt + 2;
      else pos = nxt + 1;
      valStart = pos;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    if (pos >= len) return { value, ended: 'end' };
    const c = text.charCodeAt(pos);
    if (c === COMMA) {
      pos += 1;
      return { value, ended: 'comma' };
    }
    if (c === LF) {
      pos += 1;
      line += 1;
      return { value, ended: 'line' };
    }
    if (c === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line += 1;
      return { value, ended: 'line' };
    }
    // What follows the closing quote is appended as it stands.
    const junk = readUnquoted(value);
    if (junk.added > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
    return junk;
  }

  // Finishes a record's fields: header, or a padded/cut row.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record runs to the next LF and no field opens with a
    // quote, so no quoted field can hide a comma or a line break. Then the
    // record is exactly its line split on commas, with stray CRs dropped.
    const lineEnd = text.indexOf('\n', pos);
    const segEnd = lineEnd === -1 ? len : lineEnd;
    let hasOpeningQuote = false;
    let q = text.indexOf('"', pos);
    while (q !== -1 && q < segEnd) {
      if (q === pos || text.charCodeAt(q - 1) === COMMA) {
        hasOpeningQuote = true;
        break;
      }
      q = text.indexOf('"', q + 1);
    }
    if (!hasOpeningQuote) {
      let end = segEnd;
      if (end > pos && lineEnd !== -1 && text.charCodeAt(end - 1) === CR) {
        end -= 1; // CRLF line ending
      }
      let fields;
      const cr = text.indexOf('\r', pos);
      if (cr === -1 || cr >= end) {
        fields = text.slice(pos, end).split(',');
      } else {
        // Stray CRs only: drop them, one error each, in order.
        let p = cr;
        while (p !== -1 && p < end) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          p = text.indexOf('\r', p + 1);
        }
        fields = text.slice(pos, end).replaceAll('\r', '').split(',');
      }
      if (lineEnd === -1) pos = len;
      else {
        pos = lineEnd + 1;
        line += 1;
      }
      // A line that held only stray CRs is left with no characters: no
      // record (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '') continue;
      finishRecord(fields);
      continue;
    }

    // Slow path: at least one field opens with a quote, so parse field by
    // field with the exact reference semantics.
    const fields = [];
    let ended;
    let lastQuoted = false;
    do {
      if (text.charCodeAt(pos) === QUOTE) {
        lastQuoted = true;
        const field = readQuoted();
        fields.push(field.value);
        ended = field.ended;
      } else {
        lastQuoted = false;
        const field = readUnquoted('');
        fields.push(field.value);
        ended = field.ended;
      }
    } while (ended === 'comma');

    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    finishRecord(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
