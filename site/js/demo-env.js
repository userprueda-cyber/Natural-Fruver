/*
 * Entorno que imita Google Apps Script (hoja, caché, propiedades, candados, UrlFetch) para correr
 * el código REAL del bot (apps-script/*.gs) en el navegador o en Node, sin servidor.
 * Lo usan la demo web (site/demo.html) y tests/webdemo.test.js.
 *
 * Es más estricto que Google en lo que importa: el caché no acepta más de 6 h, 100 KB por valor
 * ni claves de más de 250 caracteres, y una propiedad no pasa de 9 KB.
 */
(function (root) {
  function colToIndex(letter) { return letter.toUpperCase().charCodeAt(0) - 64; }

  class Range {
    constructor(sheet, row, col, numRows, numCols) { Object.assign(this, { sheet, row, col, numRows, numCols }); }
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
    setValues(values) { values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v))); return this; }
    setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
    setNumberFormat() { return this; }
    setFontWeight() { return this; }
    setBackground() { return this; }
    setDataValidation() { return this; }
  }

  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
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
    getLastColumn() { return this.data.reduce((m, line) => Math.max(m, line.length), 0); }
    getMaxRows() { return Math.max(1000, this.data.length); }
    getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
    getRange(a, b, c, d) {
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z]):([A-Z])$/);
        if (m) return new Range(this, 1, colToIndex(m[1]), this.getMaxRows(), 1);
        throw new Error('Unsupported A1 range ' + a);
      }
      return new Range(this, a, b, c || 1, d || 1);
    }
    appendRow(values) { const row = this.getLastRow() + 1; values.forEach((v, i) => this.set(row, i + 1, v)); }
    setFrozenRows() {}
  }

  class Spreadsheet {
    constructor() { this.sheets = {}; }
    getSheetByName(n) { return this.sheets[n] || null; }
    insertSheet(n) { this.sheets[n] = new Sheet(n); return this.sheets[n]; }
    getSpreadsheetTimeZone() { return 'America/Bogota'; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/demo'; }
  }

  function formatDate(date, tz, pattern) {
    const parts = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
    return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute);
  }

  const uuid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

  function createEnv(sources, options) {
    options = options || {};
    const ss = new Spreadsheet();
    const now = options.now || (() => Date.now());
    const store = new Map(); // caché: clave → { v, exp }
    const props = new Map();
    const sentMail = [];
    const fetches = [];
    const net = { reply: null };
    const folders = {};
    let lockHeld = false;

    const cache = {
      get(k) {
        const e = store.get(k);
        if (!e) return null;
        if (e.exp <= now()) { store.delete(k); return null; }
        return e.v;
      },
      put(k, v, ttl) {
        ttl = ttl === undefined ? 600 : ttl;
        if (String(k).length > 250) throw new Error('CacheService: clave de más de 250 caracteres');
        if (String(v).length > 100 * 1024) throw new Error('CacheService: valor de más de 100 KB');
        if (ttl > 21600) throw new Error('CacheService: expiración de más de 6 h (' + ttl + ' s)');
        store.set(k, { v: String(v), exp: now() + ttl * 1000 });
      },
      remove(k) { store.delete(k); }
    };

    const lock = {
      waitLock() { if (lockHeld) throw new Error('Lock already held (re-entrant call?)'); lockHeld = true; },
      releaseLock() { lockHeld = false; }
    };
    const validationBuilder = { requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } };

    const globals = {
      console,
      SpreadsheetApp: {
        getActiveSpreadsheet: () => ss,
        flush() {},
        getUi() { throw new Error('No UI en la demo'); },
        newDataValidation: () => validationBuilder
      },
      CacheService: { getScriptCache: () => cache },
      LockService: { getScriptLock: () => lock },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k) => (props.has(k) ? props.get(k) : null),
          setProperty: (k, v) => {
            if (String(v).length > 9000) throw new Error('PropertiesService: valor de más de 9 KB');
            props.set(k, String(v));
          },
          deleteProperty: (k) => { props.delete(k); },
          getKeys: () => Array.from(props.keys())
        })
      },
      Utilities: {
        formatDate,
        base64Decode: (s) => Array.from(root.atob ? Uint8Array.from(root.atob(s), (c) => c.charCodeAt(0)) : Buffer.from(s, 'base64')),
        getUuid: uuid,
        sleep: () => {},
        newBlob: (bytes, type, name) => ({ bytes, type, name })
      },
      DriveApp: {
        Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
        Permission: { VIEW: 'VIEW' },
        createFolder(name) {
          const id = 'folder' + (Object.keys(folders).length + 1);
          const files = [];
          folders[id] = {
            name, files, getId: () => id,
            createFile(blob) {
              const fid = 'file' + (files.length + 1);
              const f = { blob, sharing: null, getId: () => fid, setSharing(a, p) { f.sharing = [a, p]; } };
              files.push(f);
              return f;
            }
          };
          return folders[id];
        },
        getFolderById(id) { if (!folders[id]) throw new Error('not found'); return folders[id]; }
      },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
      MailApp: { sendEmail: (to, subject, body) => sentMail.push({ to, subject, body }) },
      UrlFetchApp: {
        fetch(url, opts) {
          let payload = null;
          if (opts && typeof opts.payload === 'string') { try { payload = JSON.parse(opts.payload); } catch (e) { payload = opts.payload; } } else if (opts && opts.payload) payload = opts.payload;
          fetches.push({ url, payload, headers: (opts && opts.headers) || {} });
          const r = (net.reply && net.reply(url, payload, opts)) || { status: 200, body: { messages: [{ id: 'wamid.out' + fetches.length }] } };
          if (r.throws) throw new Error(r.throws);
          const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
          return {
            getResponseCode: () => r.status,
            getContentText: () => text,
            getContent: () => (r.bytes ? Array.from(r.bytes) : Array.from(new TextEncoder().encode(text)))
          };
        }
      },
      ScriptApp: {
        getProjectTriggers: () => [],
        deleteTrigger() {},
        newTrigger: () => {
          const b = { timeBased: () => b, everyMinutes: () => b, everyHours: () => b, atHour: () => b, everyDays: () => b, create: () => ({}) };
          return b;
        }
      }
    };

    // Todos los .gs se ejecutan en un solo ámbito (igual que Apps Script): las funciones se ven entre sí.
    const names = [];
    sources.forEach((src) => {
      src.replace(/^function\s+([A-Za-z0-9_$]+)/gm, (m, n) => { names.push(n); return m; });
      src.replace(/^var\s+([A-Za-z0-9_$]+)/gm, (m, n) => { names.push(n); return m; });
    });
    const body = sources.join('\n') + '\nreturn {' + names.map((n) => n + ':' + n).join(',') + '};';
    const globalNames = Object.keys(globals);
    // eslint-disable-next-line no-new-func
    const gs = new Function(...globalNames, body)(...globalNames.map((k) => globals[k]));
    return { gs, ss, cache, props, sentMail, fetches, net, folders, store };
  }

  const api = { createEnv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NFEnv = api;
})(typeof window !== 'undefined' ? window : globalThis);
