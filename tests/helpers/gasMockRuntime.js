'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const GAS_ROOT = path.resolve(__dirname, '..', '..', 'StaycationReservationSystem');

function formatDateInTimezone(dateObj, timeZone, pattern) {
  const tz = timeZone || 'Asia/Manila';
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);

  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const hour24 = map.hour === '24' ? '00' : map.hour;
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthIdx = parseInt(map.month, 10) - 1;
  const dayNoPad = String(parseInt(map.day, 10));

  if (pattern === 'yyyy-MM-dd') {
    return `${map.year}-${map.month}-${map.day}`;
  }
  if (pattern === 'yyyyMMdd') {
    return `${map.year}${map.month}${map.day}`;
  }
  if (pattern === 'yyyy-MM-dd HH:mm:ss') {
    return `${map.year}-${map.month}-${map.day} ${hour24}:${map.minute}:${map.second}`;
  }
  if (pattern === 'MMMM d, yyyy') {
    return `${monthNames[monthIdx]} ${dayNoPad}, ${map.year}`;
  }
  return `${map.year}-${map.month}-${map.day} ${hour24}:${map.minute}:${map.second}`;
}

function createBlob(content, contentType, name) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'utf8');
  let blobName = name || 'blob';
  let mime = contentType || 'application/octet-stream';
  const blob = {
    getBytes: () => Array.from(buf),
    getDataAsString: () => buf.toString('utf8'),
    getContentType: () => mime,
    getName: () => blobName,
    setName: (n) => { blobName = n; return blob; },
    setContentType: (ct) => { mime = ct; return blob; },
    copyBlob: () => createBlob(Buffer.from(buf), mime, blobName)
  };
  return blob;
}

class MockProtection {
  constructor(target, description) {
    this._target = target;
    this._description = description || '';
    this._warningOnly = false;
    this._editors = [];
  }
  setDescription(desc) { this._description = desc; return this; }
  getDescription() { return this._description; }
  setWarningOnly(flag) { this._warningOnly = Boolean(flag); return this; }
  isWarningOnly() { return this._warningOnly; }
  getEditors() { return this._editors.slice(); }
  removeEditors(list) {
    const set = new Set(list.map((e) => (typeof e === 'string' ? e : e.getEmail())));
    this._editors = this._editors.filter((e) => !set.has(e));
    return this;
  }
  addEditor(email) {
    if (!this._editors.includes(email)) this._editors.push(email);
    return this;
  }
  canDomainEdit() { return false; }
  setDomainEdit() { return this; }
  remove() { this._removed = true; }
}

class MockRange {
  constructor(sheet, startRow, startCol, numRows, numCols) {
    this._sheet = sheet;
    this._row = startRow;
    this._col = startCol;
    this._numRows = numRows;
    this._numCols = numCols;
  }
  getRow() { return this._row; }
  getColumn() { return this._col; }
  getNumRows() { return this._numRows; }
  getNumColumns() { return this._numCols; }
  getLastRow() { return this._row + this._numRows - 1; }
  getLastColumn() { return this._col + this._numCols - 1; }
  getSheet() { return this._sheet; }
  getA1Notation() {
    const colLetter = (n) => {
      let s = '';
      while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - m) / 26);
      }
      return s;
    };
    const start = `${colLetter(this._col)}${this._row}`;
    if (this._numRows === 1 && this._numCols === 1) return start;
    const end = `${colLetter(this._col + this._numCols - 1)}${this._row + this._numRows - 1}`;
    return `${start}:${end}`;
  }
  _normalizeWriteValue(val) {
    if (typeof val === 'string' && val.startsWith("'")) {
      // Simulate Google Sheets stripping the text-escape apostrophe for stored value
      return val.substring(1);
    }
    return val === undefined || val === null ? '' : val;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this._numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < this._numCols; c++) {
        rowArr.push(this._sheet._getCell(this._row + r, this._col + c));
      }
      out.push(rowArr);
    }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map((row) => row.map((v) => (v === null || v === undefined ? '' : String(v))));
  }
  getValue() {
    return this._sheet._getCell(this._row, this._col);
  }
  setValues(matrix) {
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        this._sheet._setCell(this._row + r, this._col + c, this._normalizeWriteValue(matrix[r][c]));
      }
    }
    return this;
  }
  setValue(val) {
    this._sheet._setCell(this._row, this._col, this._normalizeWriteValue(val));
    return this;
  }
  clearContent() {
    for (let r = 0; r < this._numRows; r++) {
      for (let c = 0; c < this._numCols; c++) {
        this._sheet._setCell(this._row + r, this._col + c, '');
      }
    }
    return this;
  }
  setNumberFormat(fmt) {
    this._sheet._formats.set(this.getA1Notation(), fmt);
    return this;
  }
  setFontWeight(w) { this._sheet._styles.push({ range: this.getA1Notation(), fontWeight: w }); return this; }
  setFontColor(c) { this._sheet._styles.push({ range: this.getA1Notation(), fontColor: c }); return this; }
  setBackground(c) { this._sheet._styles.push({ range: this.getA1Notation(), background: c }); return this; }
  setHorizontalAlignment(a) { this._sheet._styles.push({ range: this.getA1Notation(), hAlign: a }); return this; }
  setVerticalAlignment(a) { this._sheet._styles.push({ range: this.getA1Notation(), vAlign: a }); return this; }
  setWrap(flag) { this._sheet._styles.push({ range: this.getA1Notation(), wrap: flag }); return this; }
  setDataValidation(rule) { this._sheet._validations.set(this.getA1Notation(), rule); return this; }
  createFilter() {
    this._sheet._filter = { range: this.getA1Notation(), remove: () => { this._sheet._filter = null; } };
    return this._sheet._filter;
  }
  protect() {
    const p = new MockProtection(this.getA1Notation());
    this._sheet._protections.push(p);
    return p;
  }
}

class MockSheet {
  constructor(spreadsheet, name) {
    this._ss = spreadsheet;
    this._name = name;
    this._grid = [];
    this._frozenRows = 0;
    this._hidden = false;
    this._columnWidths = new Map();
    this._formats = new Map();
    this._validations = new Map();
    this._conditionalFormatRules = [];
    this._styles = [];
    this._filter = null;
    this._protections = [];
    this._activeRow = 1;
    this._activeCol = 1;
  }
  getName() { return this._name; }
  setName(n) { this._name = n; return this; }
  getParent() { return this._ss; }
  _getCell(row, col) {
    const r = this._grid[row - 1];
    if (!r) return '';
    return r[col - 1] === undefined ? '' : r[col - 1];
  }
  _setCell(row, col, val) {
    while (this._grid.length < row) this._grid.push([]);
    const r = this._grid[row - 1];
    while (r.length < col) r.push('');
    r[col - 1] = val;
  }
  getLastRow() {
    for (let i = this._grid.length - 1; i >= 0; i--) {
      if (this._grid[i] && this._grid[i].some((v) => v !== '' && v !== null && v !== undefined)) {
        return i + 1;
      }
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const r of this._grid) {
      if (!r) continue;
      for (let c = r.length - 1; c >= 0; c--) {
        if (r[c] !== '' && r[c] !== null && r[c] !== undefined) {
          if (c + 1 > max) max = c + 1;
          break;
        }
      }
    }
    return max;
  }
  getMaxRows() { return Math.max(1000, this._grid.length + 50); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  getRange(row, col, numRows, numCols) {
    if (typeof row === 'string') {
      throw new Error('Use numeric getRange(row, col, numRows, numCols) in tests/code.');
    }
    return new MockRange(this, row, col, numRows || 1, numCols || 1);
  }
  getDataRange() {
    const lr = Math.max(1, this.getLastRow());
    const lc = Math.max(1, this.getLastColumn());
    return new MockRange(this, 1, 1, lr, lc);
  }
  appendRow(values) {
    const nextRow = this.getLastRow() + 1;
    const range = this.getRange(nextRow, 1, 1, values.length);
    range.setValues([values]);
    return this;
  }
  setFrozenRows(n) { this._frozenRows = n; return this; }
  getFrozenRows() { return this._frozenRows; }
  setColumnWidth(col, width) { this._columnWidths.set(col, width); return this; }
  getColumnWidth(col) { return this._columnWidths.get(col); }
  getConditionalFormatRules() { return this._conditionalFormatRules.slice(); }
  setConditionalFormatRules(rules) { this._conditionalFormatRules = rules.slice(); return this; }
  getFilter() { return this._filter; }
  hideSheet() { this._hidden = true; return this; }
  showSheet() { this._hidden = false; return this; }
  isSheetHidden() { return this._hidden; }
  activate() { this._ss._activeSheet = this; return this; }
  protect() {
    const p = new MockProtection(this._name);
    this._protections.push(p);
    return p;
  }
  getProtections() { return this._protections.filter((p) => !p._removed); }
  setActiveSelection(row, col) {
    this._activeRow = row;
    this._activeCol = col || 1;
    this._ss._activeSheet = this;
  }
  getActiveRange() {
    return new MockRange(this, this._activeRow, this._activeCol, 1, 1);
  }
  getActiveCell() {
    return this.getActiveRange();
  }
}

class MockSpreadsheet {
  constructor(id, name) {
    this._id = id || 'MOCK_SPREADSHEET_ID';
    this._name = name || 'Staycation Reservation Management';
    this._sheets = [new MockSheet(this, 'Sheet1')];
    this._activeSheet = this._sheets[0];
    this._tz = 'Asia/Manila';
  }
  getId() { return this._id; }
  getName() { return this._name; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this._id}/edit`; }
  getSpreadsheetTimeZone() { return this._tz; }
  setSpreadsheetTimeZone(tz) { this._tz = tz; }
  getSheets() { return this._sheets.slice(); }
  getSheetByName(name) { return this._sheets.find((s) => s.getName() === name) || null; }
  insertSheet(name) {
    const existing = this.getSheetByName(name);
    if (existing) throw new Error(`Sheet "${name}" already exists.`);
    const s = new MockSheet(this, name);
    this._sheets.push(s);
    return s;
  }
  deleteSheet(sheet) {
    this._sheets = this._sheets.filter((s) => s !== sheet);
    if (this._activeSheet === sheet) this._activeSheet = this._sheets[0] || null;
  }
  getActiveSheet() { return this._activeSheet; }
  setActiveSheet(sheet) { this._activeSheet = sheet; return sheet; }
  getActiveRange() { return this._activeSheet ? this._activeSheet.getActiveRange() : null; }
  getActiveCell() { return this.getActiveRange(); }
  toast() {}
}

function applyJavaReplaceAll(text, searchPattern, replacement) {
  const regex = new RegExp(searchPattern, 'g');
  // Decode Java Matcher.replaceAll escape semantics: \\ -> \ and \$ -> $
  return text.replace(regex, () => {
    let out = '';
    for (let i = 0; i < replacement.length; i++) {
      if (replacement[i] === '\\' && i + 1 < replacement.length) {
        out += replacement[i + 1];
        i++;
      } else {
        out += replacement[i];
      }
    }
    return out;
  });
}

class MockTextElement {
  constructor(parent, text) {
    this._parent = parent;
    this._text = String(text || '');
  }
  getType() { return 'TEXT'; }
  asText() { return this; }
  getParent() { return this._parent; }
  getText() { return this._text; }
  setText(t) { this._text = String(t || ''); return this; }
  insertText(offset, str) {
    this._text = this._text.slice(0, offset) + String(str || '') + this._text.slice(offset);
    return this;
  }
  deleteText(start, endInclusive) {
    if (start === 0 && endInclusive >= this._text.length - 1) {
      throw new Error('Cannot delete all text from a Text element; use setText("") instead.');
    }
    this._text = this._text.slice(0, start) + this._text.slice(endInclusive + 1);
    return this;
  }
  setBold() { return this; }
  setFontSize() { return this; }
  setForegroundColor() { return this; }
  setFontFamily() { return this; }
}

class MockDocSection {
  constructor() {
    this._children = [];
    this._paragraphs = [];
    this._tables = [];
    this._images = [];
  }
  getType() { return 'BODY_SECTION'; }
  getNumChildren() { return this._children.length; }
  getChild(i) { return this._children[i]; }
  appendParagraph(text) {
    const section = this;
    const p = {
      _attrs: {},
      _textNode: null,
      getType: () => 'PARAGRAPH',
      getNumChildren: () => 1,
      getChild: () => p._textNode,
      setAlignment: function (a) { this._attrs.alignment = a; return this; },
      setHeading: function (h) { this._attrs.heading = h; return this; },
      setSpacingBefore: function (v) { this._attrs.spacingBefore = v; return this; },
      setSpacingAfter: function (v) { this._attrs.spacingAfter = v; return this; },
      setAttributes: function (a) { Object.assign(this._attrs, a); return this; },
      setBold: function (b) { this._attrs.bold = b; return this; },
      setFontSize: function (s) { this._attrs.fontSize = s; return this; },
      setForegroundColor: function (c) { this._attrs.color = c; return this; },
      setFontFamily: function (f) { this._attrs.fontFamily = f; return this; },
      getText: function () { return this._textNode.getText(); },
      setText: function (t) { this._textNode.setText(t); return this; },
      editAsText: function () { return this._textNode; },
      clear: function () { this._textNode.setText(''); return this; },
      appendInlineImage: (blob) => {
        const img = { blob, width: 0, height: 0, setWidth(w) { this.width = w; return this; }, setHeight(h) { this.height = h; return this; }, getWidth() { return 200; }, getHeight() { return 80; } };
        section._images.push(img);
        return img;
      }
    };
    p._textNode = new MockTextElement(p, text);
    this._paragraphs.push(p);
    this._children.push(p);
    return p;
  }
  appendHorizontalRule() {
    this.appendParagraph('---');
    return {};
  }
  appendTable(cells) {
    const rows = (cells || []).map((row) => {
      const cellObjs = row.map((val) => {
        const cell = {
          _textNode: null,
          getType: () => 'TABLE_CELL',
          getNumChildren: () => 1,
          getChild: () => cell._textNode,
          getText: () => cell._textNode.getText(),
          setBackgroundColor: function () { return this; },
          setPaddingTop: function () { return this; },
          setPaddingBottom: function () { return this; },
          setPaddingLeft: function () { return this; },
          setPaddingRight: function () { return this; },
          setWidth: function () { return this; },
          editAsText: function () { return cell._textNode; }
        };
        cell._textNode = new MockTextElement(cell, val);
        return cell;
      });
      return {
        _cells: cellObjs,
        getType: () => 'TABLE_ROW',
        getNumChildren: () => cellObjs.length,
        getChild: (i) => cellObjs[i],
        getCell: (idx) => cellObjs[idx]
      };
    });
    const table = {
      _rows: rows,
      getType: () => 'TABLE',
      getNumChildren: () => rows.length,
      getChild: (i) => rows[i],
      setBorderColor: function () { return this; },
      setBorderWidth: function () { return this; },
      getRow: (i) => rows[i],
      getNumRows: () => rows.length
    };
    this._tables.push(table);
    this._children.push(table);
    return table;
  }
  appendListItem(text) {
    return this.appendParagraph('• ' + text);
  }
  getParagraphs() { return this._paragraphs; }
  getText() {
    const parts = this._paragraphs.map((p) => p.getText());
    for (const t of this._tables) {
      for (const r of t._rows) {
        parts.push(r._cells.map((c) => c.getText()).join(' | '));
      }
    }
    return parts.join('\n');
  }
  replaceText(searchPattern, replacement) {
    // Real Google Docs replaceText inserts replacement literally (does not interpret $ backreferences)
    const regex = new RegExp(searchPattern, 'g');
    for (const p of this._paragraphs) {
      p.setText(p.getText().replace(regex, () => replacement));
    }
    for (const t of this._tables) {
      for (const r of t._rows) {
        for (const c of r._cells) {
          c.editAsText().setText(c.getText().replace(regex, () => replacement));
        }
      }
    }
    return this;
  }
  clear() {
    this._children = [];
    this._paragraphs = [];
    this._tables = [];
    return this;
  }
  setMarginTop() { return this; }
  setMarginBottom() { return this; }
  setMarginLeft() { return this; }
  setMarginRight() { return this; }
  setAttributes() { return this; }
  clone() {
    const copy = new MockDocSection();
    for (const p of this._paragraphs) {
      copy.appendParagraph(p.getText());
    }
    for (const t of this._tables) {
      copy.appendTable(t._rows.map((r) => r._cells.map((c) => c.getText())));
    }
    return copy;
  }
}

class MockDocument {
  constructor(id, name) {
    this._id = id;
    this._name = name;
    this._body = new MockDocSection();
    this._header = null;
    this._footer = null;
    this._saved = false;
  }
  getId() { return this._id; }
  getName() { return this._name; }
  getUrl() { return `https://docs.google.com/document/d/${this._id}/edit`; }
  getBody() { return this._body; }
  getHeader() { return this._header; }
  addHeader() { if (!this._header) this._header = new MockDocSection(); return this._header; }
  getFooter() { return this._footer; }
  addFooter() { if (!this._footer) this._footer = new MockDocSection(); return this._footer; }
  saveAndClose() { this._saved = true; }
  clone(newId, newName) {
    const copy = new MockDocument(newId, newName);
    copy._body = this._body.clone();
    if (this._header) copy._header = this._header.clone();
    if (this._footer) copy._footer = this._footer.clone();
    return copy;
  }
}

function createGasMockRuntime(options = {}) {
  const spreadsheet = new MockSpreadsheet(options.spreadsheetId || 'SS_TEST_001', 'Staycation Reservation Management');
  const scriptPropertiesStore = new Map();
  const docPropertiesStore = new Map();
  const userPropertiesStore = new Map();
  const scriptCacheStore = new Map();
  const driveFiles = new Map();
  const driveFolders = new Map();
  const docsRegistry = new Map();
  const formsRegistry = new Map();
  const sentEmails = [];
  const triggers = [];
  const logs = [];
  const uiEvents = { menus: [], alerts: [], dialogs: [], prompts: [] };

  let idCounter = 1;
  const nextId = (prefix) => `${prefix}_${String(idCounter++).padStart(4, '0')}`;

  const state = {
    activeUserEmail: options.activeUserEmail !== undefined ? options.activeUserEmail : 'admin@staycation.test',
    effectiveUserEmail: options.effectiveUserEmail !== undefined ? options.effectiveUserEmail : 'admin@staycation.test',
    gmailAliases: options.gmailAliases || [],
    remainingDailyQuota: options.remainingDailyQuota !== undefined ? options.remainingDailyQuota : 100,
    gmailFailNext: null,
    driveFailNext: null,
    lockForceFail: false,
    lockHeld: false,
    promptResponse: { button: 'OK', text: '' },
    alertResponse: 'OK',
    urlFetchMock: null
  };

  const Access = { PRIVATE: 'PRIVATE', ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN' };
  const Permission = { NONE: 'NONE', VIEW: 'VIEW', EDIT: 'EDIT' };

  function makeDriveFile(id, name, mimeType, contentBlob, folderId) {
    const fileObj = {
      _id: id,
      _name: name,
      _mimeType: mimeType,
      _blob: contentBlob || createBlob('', mimeType, name),
      _folderId: folderId || 'ROOT',
      _trashed: false,
      _access: Access.PRIVATE,
      _permission: Permission.NONE,
      getId: () => fileObj._id,
      getName: () => fileObj._name,
      setName: (n) => { fileObj._name = n; return fileObj; },
      getMimeType: () => fileObj._mimeType,
      getUrl: () => `https://drive.google.com/file/d/${fileObj._id}/view`,
      isTrashed: () => fileObj._trashed,
      setTrashed: (t) => { fileObj._trashed = Boolean(t); return fileObj; },
      setSharing: (a, p) => { fileObj._access = a; fileObj._permission = p; return fileObj; },
      getSharingAccess: () => fileObj._access,
      getSharingPermission: () => fileObj._permission,
      getBlob: () => fileObj._blob.copyBlob(),
      getAs: (targetMime) => {
        if (state.driveFailNext) {
          const err = state.driveFailNext;
          state.driveFailNext = null;
          throw err;
        }
        const doc = docsRegistry.get(fileObj._id);
        const text = doc
          ? [doc.getHeader() ? doc.getHeader().getText() : '', doc.getBody().getText(), doc.getFooter() ? doc.getFooter().getText() : ''].filter(Boolean).join('\n')
          : fileObj._blob.getDataAsString();
        return createBlob(`%PDF-1.4\n${text}`, targetMime, fileObj._name + '.pdf');
      },
      makeCopy: (copyName, destFolder) => {
        if (state.driveFailNext) {
          const err = state.driveFailNext;
          state.driveFailNext = null;
          throw err;
        }
        const newId = nextId('FILE');
        const newFolderId = destFolder ? destFolder.getId() : fileObj._folderId;
        if (docsRegistry.has(fileObj._id)) {
          const clonedDoc = docsRegistry.get(fileObj._id).clone(newId, copyName);
          docsRegistry.set(newId, clonedDoc);
        }
        const copied = makeDriveFile(newId, copyName, fileObj._mimeType, fileObj._blob.copyBlob(), newFolderId);
        driveFiles.set(newId, copied);
        return copied;
      },
      moveTo: (destFolder) => {
        fileObj._folderId = destFolder.getId();
        return fileObj;
      }
    };
    return fileObj;
  }

  function makeDriveFolder(id, name) {
    const folderObj = {
      _id: id,
      _name: name,
      _trashed: false,
      _access: Access.PRIVATE,
      _permission: Permission.NONE,
      getId: () => folderObj._id,
      getName: () => folderObj._name,
      getUrl: () => `https://drive.google.com/drive/folders/${folderObj._id}`,
      isTrashed: () => folderObj._trashed,
      setTrashed: (t) => { folderObj._trashed = Boolean(t); return folderObj; },
      setSharing: (a, p) => { folderObj._access = a; folderObj._permission = p; return folderObj; },
      getSharingAccess: () => folderObj._access,
      getSharingPermission: () => folderObj._permission,
      createFile: (blob) => {
        if (state.driveFailNext) {
          const err = state.driveFailNext;
          state.driveFailNext = null;
          throw err;
        }
        const newId = nextId('PDF');
        const f = makeDriveFile(newId, blob.getName(), blob.getContentType(), blob.copyBlob(), folderObj._id);
        driveFiles.set(newId, f);
        return f;
      },
      getFiles: () => {
        const list = Array.from(driveFiles.values()).filter((f) => f._folderId === folderObj._id && !f._trashed);
        let idx = 0;
        return {
          hasNext: () => idx < list.length,
          next: () => list[idx++]
        };
      }
    };
    return folderObj;
  }

  function makePropertiesWrapper(map) {
    return {
      getProperty: (k) => (map.has(k) ? map.get(k) : null),
      setProperty: (k, v) => { map.set(k, String(v)); },
      setProperties: (obj) => { Object.entries(obj).forEach(([k, v]) => map.set(k, String(v))); },
      deleteProperty: (k) => { map.delete(k); },
      getProperties: () => Object.fromEntries(map.entries()),
      deleteAllProperties: () => { map.clear(); }
    };
  }

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    Logger: {
      log: (msg) => logs.push(String(msg))
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => formatDateInTimezone(d, tz, fmt),
      computeDigest: (algo, input) => {
        const buf = crypto.createHash('sha256').update(String(input), 'utf8').digest();
        return Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
      },
      base64Encode: (str) => Buffer.from(String(str), 'utf8').toString('base64'),
      newBlob: (data, contentType, name) => createBlob(data, contentType, name)
    },
    PropertiesService: {
      getScriptProperties: () => makePropertiesWrapper(scriptPropertiesStore),
      getDocumentProperties: () => makePropertiesWrapper(docPropertiesStore),
      getUserProperties: () => makePropertiesWrapper(userPropertiesStore)
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (scriptCacheStore.has(k) ? scriptCacheStore.get(k) : null),
        put: (k, v) => { scriptCacheStore.set(k, String(v)); },
        remove: (k) => { scriptCacheStore.delete(k); }
      })
    },
    MimeType: {
      GOOGLE_DOCS: 'application/vnd.google-apps.document',
      PDF: 'application/pdf',
      PNG: 'image/png',
      JPEG: 'image/jpeg'
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (state.lockForceFail || state.lockHeld) return false;
          state.lockHeld = true;
          return true;
        },
        waitLock: () => {
          if (state.lockForceFail || state.lockHeld) throw new Error('Lock timeout');
          state.lockHeld = true;
        },
        releaseLock: () => { state.lockHeld = false; }
      }),
      getDocumentLock: () => sandbox.LockService.getScriptLock()
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => state.activeUserEmail }),
      getEffectiveUser: () => ({ getEmail: () => state.effectiveUserEmail }),
      getScriptTimeZone: () => 'Asia/Manila'
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: (id) => (id === spreadsheet.getId() ? spreadsheet : null),
      flush: () => {},
      ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
      newDataValidation: () => {
        const rule = { values: [], allowInvalid: false };
        const builder = {
          requireValueInList: (vals) => { rule.values = vals.slice(); return builder; },
          setAllowInvalid: (flag) => { rule.allowInvalid = flag; return builder; },
          build: () => Object.assign({}, rule)
        };
        return builder;
      },
      newConditionalFormatRule: () => {
        const rule = { whenTextEqualTo: null, bg: null, fg: null, ranges: [] };
        const builder = {
          whenTextEqualTo: (t) => { rule.whenTextEqualTo = t; return builder; },
          setBackground: (bg) => { rule.bg = bg; return builder; },
          setFontColor: (fg) => { rule.fg = fg; return builder; },
          setBold: (b) => { rule.bold = b; return builder; },
          setRanges: (r) => { rule.ranges = r; return builder; },
          build: () => Object.assign({}, rule)
        };
        return builder;
      },
      getUi: () => ({
        ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
        Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' },
        createMenu: (title) => {
          const menu = { title, items: [] };
          const api = {
            addItem: (label, fn) => { menu.items.push({ type: 'item', label, fn }); return api; },
            addSeparator: () => { menu.items.push({ type: 'separator' }); return api; },
            addToUi: () => { uiEvents.menus.push(menu); }
          };
          return api;
        },
        alert: (title, message) => {
          uiEvents.alerts.push({ title, message });
          return state.alertResponse;
        },
        prompt: (title, message) => {
          uiEvents.prompts.push({ title, message });
          return {
            getSelectedButton: () => state.promptResponse.button,
            getResponseText: () => state.promptResponse.text
          };
        },
        showModalDialog: (htmlOutput, title) => {
          uiEvents.dialogs.push({ title, html: htmlOutput.getContent(), width: htmlOutput._width, height: htmlOutput._height });
        }
      })
    },
    FormApp: {
      DestinationType: { SPREADSHEET: 'SPREADSHEET' },
      createTextValidation: () => {
        const v = { rules: [] };
        const b = {
          requireTextIsEmail: () => { v.rules.push('email'); return b; },
          requireTextMatchesPattern: (p) => { v.rules.push({ pattern: p }); return b; },
          requireNumberGreaterThan: (n) => { v.rules.push({ gt: n }); return b; },
          setHelpText: (t) => { v.helpText = t; return b; },
          build: () => v
        };
        return b;
      },
      create: (title) => {
        const id = nextId('FORM');
        const form = {
          _id: id,
          _title: title,
          _description: '',
          _items: [],
          _destination: null,
          _collectEmail: false,
          _requireLogin: false,
          getId: () => form._id,
          getTitle: () => form._title,
          getPublishedUrl: () => `https://docs.google.com/forms/d/e/${form._id}/viewform`,
          getEditUrl: () => `https://docs.google.com/forms/d/${form._id}/edit`,
          setDescription: (d) => { form._description = d; return form; },
          setCollectEmail: (b) => { form._collectEmail = b; return form; },
          setRequireLogin: (b) => { form._requireLogin = b; return form; },
          setConfirmationMessage: (m) => { form._confirmationMessage = m; return form; },
          setDestination: (type, targetId) => {
            form._destination = { type, targetId };
            if (!spreadsheet.getSheetByName('Form Responses 1')) {
              const raw = spreadsheet.insertSheet('Form Responses 1');
              raw.appendRow(['Timestamp', ...form._items.map((i) => i.title)]);
            }
            return form;
          },
          addTextItem: () => {
            const item = { type: 'TEXT', title: '', required: false, validation: null };
            form._items.push(item);
            const api = {
              setTitle: (t) => { item.title = t; return api; },
              setHelpText: (h) => { item.helpText = h; return api; },
              setRequired: (r) => { item.required = r; return api; },
              setValidation: (v) => { item.validation = v; return api; }
            };
            return api;
          },
          addDateItem: () => {
            const item = { type: 'DATE', title: '', required: false };
            form._items.push(item);
            const api = {
              setTitle: (t) => { item.title = t; return api; },
              setHelpText: (h) => { item.helpText = h; return api; },
              setRequired: (r) => { item.required = r; return api; }
            };
            return api;
          },
          addListItem: () => {
            const item = { type: 'LIST', title: '', required: false, choices: [] };
            form._items.push(item);
            const api = {
              setTitle: (t) => { item.title = t; return api; },
              setHelpText: (h) => { item.helpText = h; return api; },
              setChoiceValues: (vals) => { item.choices = vals.slice(); return api; },
              setRequired: (r) => { item.required = r; return api; }
            };
            return api;
          },
          addParagraphTextItem: () => {
            const item = { type: 'PARAGRAPH', title: '', required: false };
            form._items.push(item);
            const api = {
              setTitle: (t) => { item.title = t; return api; },
              setHelpText: (h) => { item.helpText = h; return api; },
              setRequired: (r) => { item.required = r; return api; }
            };
            return api;
          },
          addCheckboxItem: () => {
            const item = { type: 'CHECKBOX', title: '', required: false, choices: [] };
            form._items.push(item);
            const api = {
              setTitle: (t) => { item.title = t; return api; },
              setHelpText: (h) => { item.helpText = h; return api; },
              setChoiceValues: (vals) => { item.choices = vals.slice(); return api; },
              setRequired: (r) => { item.required = r; return api; }
            };
            return api;
          }
        };
        formsRegistry.set(id, form);
        return form;
      },
      openById: (id) => {
        if (!formsRegistry.has(id)) throw new Error(`Form not found: ${id}`);
        return formsRegistry.get(id);
      }
    },
    DocumentApp: {
      ElementType: { TEXT: 'TEXT', PARAGRAPH: 'PARAGRAPH', TABLE: 'TABLE', TABLE_ROW: 'TABLE_ROW', TABLE_CELL: 'TABLE_CELL' },
      HorizontalAlignment: { LEFT: 'LEFT', CENTER: 'CENTER', RIGHT: 'RIGHT' },
      ParagraphHeading: { NORMAL: 'NORMAL', HEADING1: 'HEADING1', HEADING2: 'HEADING2', TITLE: 'TITLE', SUBTITLE: 'SUBTITLE' },
      Attribute: {
        FONT_FAMILY: 'FONT_FAMILY',
        FONT_SIZE: 'FONT_SIZE',
        FOREGROUND_COLOR: 'FOREGROUND_COLOR',
        BOLD: 'BOLD',
        ITALIC: 'ITALIC',
        BACKGROUND_COLOR: 'BACKGROUND_COLOR'
      },
      create: (name) => {
        const id = nextId('DOC');
        const doc = new MockDocument(id, name);
        docsRegistry.set(id, doc);
        const f = makeDriveFile(id, name, 'application/vnd.google-apps.document', createBlob('', 'application/vnd.google-apps.document', name));
        driveFiles.set(id, f);
        return doc;
      },
      openById: (id) => {
        if (!docsRegistry.has(id)) {
          throw new Error(`Document not found or inaccessible: ${id}`);
        }
        return docsRegistry.get(id);
      }
    },
    DriveApp: {
      Access,
      Permission,
      createFolder: (name) => {
        const id = nextId('FOLDER');
        const folder = makeDriveFolder(id, name);
        driveFolders.set(id, folder);
        return folder;
      },
      getFolderById: (id) => {
        if (!driveFolders.has(id) || driveFolders.get(id).isTrashed()) {
          throw new Error(`Drive folder not found: ${id}`);
        }
        return driveFolders.get(id);
      },
      getFileById: (id) => {
        if (!driveFiles.has(id) || driveFiles.get(id).isTrashed()) {
          throw new Error(`Drive file not found: ${id}`);
        }
        return driveFiles.get(id);
      }
    },
    GmailApp: {
      getAliases: () => state.gmailAliases.slice(),
      sendEmail: (recipient, subject, body, emailOptions) => {
        if (state.gmailFailNext) {
          const err = state.gmailFailNext;
          state.gmailFailNext = null;
          throw err;
        }
        if (state.remainingDailyQuota <= 0) {
          throw new Error('Service invoked too many times for one day: email.');
        }
        state.remainingDailyQuota -= 1;
        sentEmails.push({
          recipient,
          subject,
          body,
          options: emailOptions || {},
          sentAt: new Date().toISOString()
        });
      }
    },
    MailApp: {
      getRemainingDailyQuota: () => state.remainingDailyQuota
    },
    UrlFetchApp: {
      fetch: (url) => {
        if (state.urlFetchMock) return state.urlFetchMock(url);
        return {
          getResponseCode: () => 200,
          getBlob: () => createBlob('PNG_DATA', 'image/png', 'logo.png')
        };
      }
    },
    HtmlService: {
      createHtmlOutput: (html) => {
        const obj = {
          _content: String(html || ''),
          _width: 600,
          _height: 400,
          _title: '',
          getContent: () => obj._content,
          setWidth: (w) => { obj._width = w; return obj; },
          setHeight: (h) => { obj._height = h; return obj; },
          setTitle: (t) => { obj._title = t; return obj; }
        };
        return obj;
      },
      createHtmlOutputFromFile: (fileName) => {
        const fullPath = path.join(GAS_ROOT, fileName.endsWith('.html') ? fileName : `${fileName}.html`);
        if (!fs.existsSync(fullPath)) throw new Error(`HTML file not found: ${fileName}`);
        return sandbox.HtmlService.createHtmlOutput(fs.readFileSync(fullPath, 'utf8'));
      },
      createTemplateFromFile: (fileName) => {
        const fullPath = path.join(GAS_ROOT, fileName.endsWith('.html') ? fileName : `${fileName}.html`);
        if (!fs.existsSync(fullPath)) throw new Error(`HTML template not found: ${fileName}`);
        const raw = fs.readFileSync(fullPath, 'utf8');
        const template = {
          evaluate: () => {
            // Evaluate simple <?= varName ?> and <?!= varName ?> expressions against template properties
            const rendered = raw.replace(/<\?!=\s*([a-zA-Z0-9_.]+)\s*\?>|<\?=\s*([a-zA-Z0-9_.]+)\s*\?>/g, (_, rawKey, escKey) => {
              const key = rawKey || escKey;
              const val = template[key];
              return val === undefined || val === null ? '' : String(val);
            });
            return sandbox.HtmlService.createHtmlOutput(rendered);
          }
        };
        return template;
      }
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => {
        const idx = triggers.indexOf(t);
        if (idx >= 0) triggers.splice(idx, 1);
      },
      newTrigger: (handlerFunction) => {
        const t = {
          _handler: handlerFunction,
          _eventType: null,
          _sourceId: null,
          getHandlerFunction: () => t._handler,
          getEventType: () => t._eventType,
          getUniqueId: () => `TRIG_${t._handler}_${t._eventType}`
        };
        const builder = {
          forSpreadsheet: (ss) => {
            t._sourceId = typeof ss === 'string' ? ss : ss.getId();
            return {
              onFormSubmit: () => ({ create: () => { t._eventType = 'ON_FORM_SUBMIT'; triggers.push(t); return t; } }),
              onEdit: () => ({ create: () => { t._eventType = 'ON_EDIT'; triggers.push(t); return t; } })
            };
          },
          forForm: (form) => {
            t._sourceId = typeof form === 'string' ? form : form.getId();
            return {
              onFormSubmit: () => ({ create: () => { t._eventType = 'ON_FORM_SUBMIT'; triggers.push(t); return t; } })
            };
          }
        };
        return builder;
      }
    }
  };

  const context = vm.createContext(sandbox);

  function loadGasFiles(fileNames) {
    const filesToLoad = fileNames || fs.readdirSync(GAS_ROOT).filter((f) => f.endsWith('.gs')).sort();
    for (const fileName of filesToLoad) {
      const fullPath = path.join(GAS_ROOT, fileName);
      const source = fs.readFileSync(fullPath, 'utf8');
      vm.runInContext(source, context, { filename: fileName });
    }
  }

  return {
    ctx: context,
    state,
    spreadsheet,
    driveFiles,
    driveFolders,
    docsRegistry,
    formsRegistry,
    sentEmails,
    triggers,
    logs,
    uiEvents,
    scriptPropertiesStore,
    scriptCacheStore,
    loadGasFiles
  };
}

module.exports = {
  GAS_ROOT,
  createGasMockRuntime
};
