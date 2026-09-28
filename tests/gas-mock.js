// In-memory stand-ins for the Apps Script services used by apps-script/*.gs,
// so the backend logic can be tested with `node --test`.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function colToIndex(letter) {
  return letter.toUpperCase().charCodeAt(0) - 64;
}

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) {
    this.sheet.set(this.row, this.col, v);
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setDataValidation() { return this; }
}

class Sheet {
  constructor(name) {
    this.name = name;
    this.data = [];
  }
  set(row, col, v) {
    while (this.data.length < row) this.data.push([]);
    const line = this.data[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = v;
  }
  getLastRow() {
    let last = 0;
    this.data.forEach((line, i) => { if (line.some((v) => v !== '' && v !== undefined)) last = i + 1; });
    return last;
  }
  getLastColumn() {
    return this.data.reduce((m, line) => Math.max(m, line.length), 0);
  }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getDataRange() {
    return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn());
  }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]):([A-Z])$/);
      if (m) return new Range(this, 1, colToIndex(m[1]), this.getMaxRows(), 1);
      throw new Error('Unsupported A1 range ' + a);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  appendRow(values) {
    const row = this.getLastRow() + 1;
    values.forEach((v, i) => this.set(row, i + 1, v));
  }
  setFrozenRows() {}
}

class Spreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new Sheet(n); return this.sheets[n]; }
  getSpreadsheetTimeZone() { return 'America/Bogota'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/test'; }
}

function formatDate(date, tz, pattern) {
  const parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  return pattern
    .replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', parts.hour).replace('mm', parts.minute);
}

function createEnv() {
  const ss = new Spreadsheet();
  const cache = new Map();
  const props = new Map();
  const sentMail = [];
  // Llamadas a la API de WhatsApp/Meta: { url, payload }. fetchReply(url, payload) puede cambiar la respuesta.
  const fetches = [];
  const net = { reply: null };
  const folders = {};
  let lockHeld = false;

  const lock = {
    waitLock() {
      if (lockHeld) throw new Error('Lock already held (re-entrant call?)');
      lockHeld = true;
    },
    releaseLock() { lockHeld = false; }
  };

  const validationBuilder = {
    requireValueInList() { return this; },
    setAllowInvalid() { return this; },
    build() { return {}; }
  };

  const globals = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush() {},
      getUi() { throw new Error('No UI in tests'); },
      newDataValidation: () => validationBuilder
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => cache.set(k, v),
        remove: (k) => cache.delete(k)
      })
    },
    LockService: { getScriptLock: () => lock },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, v)
      })
    },
    Utilities: {
      formatDate,
      base64Decode: (s) => Buffer.from(s, 'base64'),
      getUuid: () => require('crypto').randomUUID(),
      newBlob: (bytes, type, name) => ({ bytes, type, name })
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
      Permission: { VIEW: 'VIEW' },
      createFolder(name) {
        const id = 'folder' + (Object.keys(folders).length + 1);
        const files = [];
        folders[id] = {
          name, files,
          getId: () => id,
          createFile(blob) {
            const fid = 'file' + (files.length + 1);
            const f = { blob, sharing: null, getId: () => fid, setSharing(a, p) { f.sharing = [a, p]; } };
            files.push(f);
            return f;
          }
        };
        return folders[id];
      },
      getFolderById(id) {
        if (!folders[id]) throw new Error('not found');
        return folders[id];
      }
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    },
    MailApp: { sendEmail: (to, subject, body) => sentMail.push({ to, subject, body }) },
    UrlFetchApp: {
      fetch(url, opts) {
        const payload = opts && opts.payload ? JSON.parse(opts.payload) : null;
        fetches.push({ url, payload, headers: (opts && opts.headers) || {} });
        const r = (net.reply && net.reply(url, payload)) || { status: 200, body: { messages: [{ id: 'wamid.out' }] } };
        return { getResponseCode: () => r.status, getContentText: () => JSON.stringify(r.body) };
      }
    },    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger() {},
      newTrigger: () => {
        const b = { timeBased: () => b, everyMinutes: () => b, everyHours: () => b, atHour: () => b, everyDays: () => b, create: () => ({}) };
        return b;
      }
    }
  };

  const context = vm.createContext(globals);
  const dir = path.join(__dirname, '..', 'apps-script');
  fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), context, { filename: f });
  });

  return { gs: context, ss, cache, props, sentMail, folders, fetches, net, isLocked: () => lockHeld };
}

module.exports = { createEnv };
