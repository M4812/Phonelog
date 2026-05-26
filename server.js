const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
let lastIdMillis = 0;
let idSequence = 0;

function getRecordsFilePath(baseDir = process.cwd()) {
  return path.join(baseDir, 'data', 'records.json');
}

function getContactsFilePath(baseDir = process.cwd()) {
  return path.join(baseDir, 'data', 'contacts.json');
}

function getOrganizationsFilePath(baseDir = process.cwd()) {
  return path.join(baseDir, 'data', 'organizations.json');
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeStatsUnit(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeContact(contact) {
  const now = getCurrentLocalDateTime();
  return {
    id: String(contact.id || createId()),
    phoneNumber: String(contact.phoneNumber || '').trim(),
    phoneDigits: normalizePhoneDigits(contact.phoneNumber || contact.phoneDigits),
    callerUnit: String(contact.callerUnit || '').trim(),
    callerName: String(contact.callerName || '').trim(),
    remark: String(contact.remark || '').trim(),
    callCount: Number(contact.callCount || 0),
    createdAt: normalizeDateTime(contact.createdAt || now),
    updatedAt: normalizeDateTime(contact.updatedAt || now)
  };
}

function normalizeOrganization(organization) {
  const now = getCurrentLocalDateTime();
  return {
    id: String(organization.id || createId()),
    name: String(organization.name || '').trim(),
    createdAt: normalizeDateTime(organization.createdAt || now),
    updatedAt: normalizeDateTime(organization.updatedAt || now)
  };
}

function compareContactsDesc(a, b) {
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) ||
    String(b.id || '').localeCompare(String(a.id || ''));
}

function compareContactsByCallCountDesc(a, b) {
  return Number(b.callCount || 0) - Number(a.callCount || 0) ||
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) ||
    String(b.id || '').localeCompare(String(a.id || ''));
}

const CHINESE_NUMBERS = ['零', '一', '二', '三', '四', '五', '六', '七', '八'];

function getOrganizationSortRank(name) {
  const normalizedName = normalizeStatsUnit(name);
  if (normalizedName === '中心') {
    return 0;
  }

  for (let office = 1; office <= 7; office += 1) {
    const officeNames = [`${CHINESE_NUMBERS[office]}处`, `${office}处`];
    if (officeNames.includes(normalizedName)) {
      return office * 100;
    }

    for (let section = 1; section <= 8; section += 1) {
      const sectionNames = officeNames.flatMap((officeName) => [
        `${officeName}${CHINESE_NUMBERS[section]}科`,
        `${officeName}${section}科`
      ]);
      if (sectionNames.includes(normalizedName)) {
        return office * 100 + section;
      }
    }
  }

  return 1000;
}

function compareOrganizations(a, b) {
  const rankDiff = getOrganizationSortRank(a.name) - getOrganizationSortRank(b.name);
  return rankDiff ||
    String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN') ||
    String(a.id || '').localeCompare(String(b.id || ''));
}

function ensureRecordsFile(recordsFile = getRecordsFilePath()) {
  const dataDir = path.dirname(recordsFile);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(recordsFile)) {
    fs.writeFileSync(recordsFile, '[]', 'utf8');
    return [];
  }

  const raw = fs.readFileSync(recordsFile, 'utf8').trim();
  if (!raw) {
    fs.writeFileSync(recordsFile, '[]', 'utf8');
    return [];
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('records.json 必须是数组格式');
  }

  return parsed.map(normalizeRecord);
}

function ensureContactsFile(contactsFile = getContactsFilePath()) {
  const dataDir = path.dirname(contactsFile);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(contactsFile)) {
    fs.writeFileSync(contactsFile, '[]', 'utf8');
    return [];
  }

  const raw = fs.readFileSync(contactsFile, 'utf8').trim();
  if (!raw) {
    fs.writeFileSync(contactsFile, '[]', 'utf8');
    return [];
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('contacts.json 必须是数组格式');
  }

  return parsed.map(normalizeContact);
}

function ensureOrganizationsFile(organizationsFile = getOrganizationsFilePath()) {
  const dataDir = path.dirname(organizationsFile);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(organizationsFile)) {
    fs.writeFileSync(organizationsFile, '[]', 'utf8');
    return [];
  }

  const raw = fs.readFileSync(organizationsFile, 'utf8').trim();
  if (!raw) {
    fs.writeFileSync(organizationsFile, '[]', 'utf8');
    return [];
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('organizations.json 必须是数组格式');
  }

  return parsed.map(normalizeOrganization).filter((organization) => organization.name);
}

function readRecords(recordsFile = getRecordsFilePath()) {
  return ensureRecordsFile(recordsFile);
}

function readContacts(contactsFile = getContactsFilePath()) {
  return ensureContactsFile(contactsFile).sort(compareContactsDesc);
}

function readOrganizations(organizationsFile = getOrganizationsFilePath()) {
  return ensureOrganizationsFile(organizationsFile).sort(compareOrganizations);
}

function writeRecords(records, recordsFile = getRecordsFilePath()) {
  const safeRecords = records.map(normalizeRecord).sort(compareByCallTimeDesc);
  const dataDir = path.dirname(recordsFile);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(recordsFile, JSON.stringify(safeRecords, null, 2), 'utf8');
  return safeRecords;
}

function writeContacts(contacts, contactsFile = getContactsFilePath()) {
  const safeContacts = contacts.map(normalizeContact).sort(compareContactsDesc);
  const dataDir = path.dirname(contactsFile);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(contactsFile, JSON.stringify(safeContacts, null, 2), 'utf8');
  return safeContacts;
}

function writeOrganizations(organizations, organizationsFile = getOrganizationsFilePath()) {
  const safeOrganizations = organizations
    .map(normalizeOrganization)
    .filter((organization) => organization.name)
    .sort(compareOrganizations);
  const dataDir = path.dirname(organizationsFile);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(organizationsFile, JSON.stringify(safeOrganizations, null, 2), 'utf8');
  return safeOrganizations;
}

function organizationNameExists(name, organizationsFile = getOrganizationsFilePath()) {
  const target = normalizeStatsUnit(name);
  if (!target) {
    return false;
  }
  return readOrganizations(organizationsFile).some((organization) => normalizeStatsUnit(organization.name) === target);
}

function createOrganization(organization, organizationsFile = getOrganizationsFilePath()) {
  const name = String(organization.name || '').trim();
  if (!name) {
    throw new Error('请填写组织机构名称');
  }
  if (organizationNameExists(name, organizationsFile)) {
    throw new Error('组织机构已存在');
  }

  const created = normalizeOrganization({ name });
  const organizations = writeOrganizations([...readOrganizations(organizationsFile), created], organizationsFile);
  return { organization: organizations.find((item) => item.id === created.id), organizations };
}

function updateOrganizationById(id, organization, organizationsFile = getOrganizationsFilePath()) {
  const name = String(organization.name || '').trim();
  if (!name) {
    throw new Error('请填写组织机构名称');
  }

  const organizations = readOrganizations(organizationsFile);
  const index = organizations.findIndex((item) => item.id === id);
  if (index === -1) {
    return { organization: null, organizations };
  }

  const duplicate = organizations.find((item) => item.id !== id && normalizeStatsUnit(item.name) === normalizeStatsUnit(name));
  if (duplicate) {
    throw new Error('组织机构已存在');
  }

  const updated = normalizeOrganization({
    ...organizations[index],
    name,
    updatedAt: getCurrentLocalDateTime()
  });
  organizations[index] = updated;
  const nextOrganizations = writeOrganizations(organizations, organizationsFile);
  return { organization: nextOrganizations.find((item) => item.id === id), organizations: nextOrganizations };
}

function isOrganizationUsed(name, recordsFile = getRecordsFilePath()) {
  const target = normalizeStatsUnit(name);
  return readRecords(recordsFile).some((record) => normalizeStatsUnit(record.callerUnit) === target);
}

function deleteOrganizationById(id, organizationsFile = getOrganizationsFilePath(), recordsFile = getRecordsFilePath()) {
  const organizations = readOrganizations(organizationsFile);
  const index = organizations.findIndex((organization) => organization.id === id);
  if (index === -1) {
    return { deleted: null, organizations };
  }

  if (isOrganizationUsed(organizations[index].name, recordsFile)) {
    const error = new Error('该组织机构已有来电记录，不能删除');
    error.statusCode = 409;
    throw error;
  }

  const [deleted] = organizations.splice(index, 1);
  const nextOrganizations = writeOrganizations(organizations, organizationsFile);
  return { deleted, organizations: nextOrganizations };
}

function upsertContactByPhone(contact, contactsFile = getContactsFilePath()) {
  const phoneDigits = normalizePhoneDigits(contact.phoneNumber);
  if (!phoneDigits) {
    throw new Error('请填写来电电话');
  }

  const contacts = readContacts(contactsFile);
  const index = contacts.findIndex((item) => item.phoneDigits === phoneDigits);
  const now = getCurrentLocalDateTime();

  if (index === -1) {
    const createdContact = normalizeContact({
      ...contact,
      phoneDigits,
      callCount: Number(contact.callCount || 0) + 1,
      createdAt: now,
      updatedAt: now
    });
    const nextContacts = writeContacts([...contacts, createdContact], contactsFile);
    return { created: true, contact: nextContacts.find((item) => item.id === createdContact.id), contacts: nextContacts };
  }

  // 核心去重逻辑：同一个标准化电话号码只保留一条通讯录记录。
  // 再次提交相同电话时，不新增数组项，而是覆盖更新单位、姓名和备注，并累计来电次数。
  const existing = contacts[index];
  const updatedContact = normalizeContact({
    ...existing,
    phoneNumber: String(contact.phoneNumber || existing.phoneNumber).trim(),
    phoneDigits,
    callerUnit: String(contact.callerUnit || '').trim(),
    callerName: String(contact.callerName || '').trim(),
    remark: String(contact.remark || '').trim(),
    callCount: Number(existing.callCount || 0) + 1,
    updatedAt: now
  });

  contacts[index] = updatedContact;
  const nextContacts = writeContacts(contacts, contactsFile);
  return { created: false, contact: updatedContact, contacts: nextContacts };
}

function findContactByPhone(phoneNumber, contactsFile = getContactsFilePath()) {
  const phoneDigits = normalizePhoneDigits(phoneNumber);
  if (!phoneDigits) {
    return null;
  }

  return readContacts(contactsFile).find((contact) =>
    contact.phoneDigits === phoneDigits ||
    contact.phoneDigits.includes(phoneDigits) ||
    phoneDigits.includes(contact.phoneDigits)
  ) || null;
}

function deleteContactById(id, contactsFile = getContactsFilePath()) {
  const contacts = readContacts(contactsFile);
  const index = contacts.findIndex((contact) => contact.id === id);

  if (index === -1) {
    return { deleted: null, contacts };
  }

  const [deleted] = contacts.splice(index, 1);
  const nextContacts = writeContacts(contacts, contactsFile);
  return { deleted, contacts: nextContacts };
}

function getContactStatsFromRecords(recordsFile = getRecordsFilePath()) {
  const byUnit = new Map();
  const byPhone = new Map();

  readRecords(recordsFile).forEach((record) => {
    const phoneDigits = normalizePhoneDigits(record.phoneNumber);
    const unitKey = normalizeStatsUnit(record.callerUnit);
    const statsKey = unitKey || phoneDigits;
    const targetStats = unitKey ? byUnit : byPhone;

    if (!statsKey) {
      return;
    }

    const current = targetStats.get(statsKey) || {
      callCount: 0,
      updatedAt: ''
    };
    const callTime = normalizeDateTime(record.callTime);

    current.callCount += 1;
    if (callTime && callTime > current.updatedAt) {
      current.updatedAt = callTime;
    }

    targetStats.set(statsKey, current);
  });

  return { byUnit, byPhone };
}

function applyRecordStatsToContacts(contacts, recordsFile = getRecordsFilePath()) {
  const stats = getContactStatsFromRecords(recordsFile);

  return contacts.map((contact) => {
    const unitKey = normalizeStatsUnit(contact.callerUnit);
    const recordStats = unitKey
      ? stats.byUnit.get(unitKey)
      : stats.byPhone.get(contact.phoneDigits);
    if (!recordStats) {
      return {
        ...contact,
        callCount: 0
      };
    }

    return {
      ...contact,
      callCount: recordStats.callCount,
      updatedAt: recordStats.updatedAt || contact.updatedAt
    };
  }).sort(compareContactsByCallCountDesc);
}

function getContactUnitSummaries(recordsFile = getRecordsFilePath()) {
  const units = new Map();

  readRecords(recordsFile).forEach((record) => {
    const callerUnit = String(record.callerUnit || '').trim();
    const unitKey = normalizeStatsUnit(callerUnit);
    if (!unitKey) {
      return;
    }

    const callTime = normalizeDateTime(record.callTime);
    const current = units.get(unitKey) || {
      id: `unit-${unitKey}`,
      callerUnit,
      phoneNumber: '',
      callerName: '',
      callCount: 0,
      updatedAt: ''
    };

    current.callCount += 1;
    if (callTime && callTime >= current.updatedAt) {
      current.updatedAt = callTime;
      current.phoneNumber = String(record.phoneNumber || '').trim();
      current.callerName = String(record.callerName || '').trim();
      current.callerUnit = callerUnit;
    }

    units.set(unitKey, current);
  });

  return Array.from(units.values()).sort(compareContactsByCallCountDesc);
}

function syncContactsFromRecords(recordsFile = getRecordsFilePath(), contactsFile = getContactsFilePath()) {
  const records = readRecords(recordsFile);

  records
    .filter((record) => normalizePhoneDigits(record.phoneNumber))
    .sort(compareByCallTimeDesc)
    .reverse()
    .forEach((record) => {
      upsertContactByPhone({
        phoneNumber: record.phoneNumber,
        callerUnit: record.callerUnit,
        callerName: record.callerName,
        remark: ''
      }, contactsFile);
    });

  return applyRecordStatsToContacts(readContacts(contactsFile), recordsFile);
}

function createId() {
  const millis = Date.now();
  if (millis === lastIdMillis) {
    idSequence += 1;
  } else {
    lastIdMillis = millis;
    idSequence = 0;
  }

  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(16).slice(2);

  return `${millis}-${String(idSequence).padStart(4, '0')}-${suffix}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function getCurrentLocalDateTime() {
  const now = new Date();
  return [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}:${pad(now.getMinutes())}`
  ].join(' ');
}

function normalizeDateTime(value) {
  if (!value) {
    return getCurrentLocalDateTime();
  }

  return String(value).trim().replace('T', ' ').slice(0, 16);
}

function parseResolved(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const text = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', '是', '已解决', '解决'].includes(text);
}

function normalizeRecord(record) {
  return {
    id: String(record.id || createId()),
    callTime: normalizeDateTime(record.callTime),
    callerName: String(record.callerName || '').trim(),
    callerUnit: String(record.callerUnit || '').trim(),
    phoneNumber: String(record.phoneNumber || '').trim(),
    question: String(record.question || '').trim(),
    isResolved: parseResolved(record.isResolved),
    resolution: String(record.resolution || '').trim()
  };
}

function getIdSortKey(id) {
  const match = String(id || '').match(/^(\d{13})-(\d{4})-/);
  return match ? `${match[1]}-${match[2]}` : '';
}

function compareByCallTimeDesc(a, b) {
  const left = String(a.callTime || '');
  const right = String(b.callTime || '');
  const callTimeOrder = right.localeCompare(left);
  if (callTimeOrder !== 0) {
    return callTimeOrder;
  }

  const leftIdSortKey = getIdSortKey(a.id);
  const rightIdSortKey = getIdSortKey(b.id);
  if (leftIdSortKey || rightIdSortKey) {
    return rightIdSortKey.localeCompare(leftIdSortKey) ||
      String(b.id).localeCompare(String(a.id));
  }

  return String(b.id).localeCompare(String(a.id));
}

function mergeRecords(existingRecords, incomingRecords) {
  const merged = new Map();

  existingRecords.map(normalizeRecord).forEach((record) => {
    merged.set(record.id, record);
  });

  incomingRecords.map(normalizeRecord).forEach((record) => {
    merged.set(record.id, record);
  });

  return Array.from(merged.values()).sort(compareByCallTimeDesc);
}

function deleteRecordById(id, recordsFile = getRecordsFilePath()) {
  const records = readRecords(recordsFile);
  const index = records.findIndex((record) => record.id === id);

  if (index === -1) {
    return { deleted: null, records };
  }

  const [deleted] = records.splice(index, 1);
  const nextRecords = writeRecords(records, recordsFile);
  return { deleted, records: nextRecords };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function recordsToCsv(records) {
  const headers = ['ID', '来电时间', '来电人姓名', '来电单位', '电话号码', '来电问题/诉求', '是否解决', '处理结果'];
  const rows = records
    .map(normalizeRecord)
    .sort(compareByCallTimeDesc)
    .map((record) => [
      record.id,
      record.callTime,
      record.callerName,
      record.callerUnit,
      record.phoneNumber,
      record.question,
      record.isResolved ? '已解决' : '未解决',
      record.resolution
    ]);

  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')}`;
}

function parseCsv(text) {
  const cleanText = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < cleanText.length; index += 1) {
    const char = cleanText[index];
    const next = cleanText[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);

  return rows.filter((currentRow) => currentRow.some((cell) => String(cell).trim() !== ''));
}

function pick(rowObject, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(rowObject, name)) {
      return rowObject[name];
    }
  }
  return '';
}

function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map((header) => String(header).trim());
  return rows.slice(1).map((row) => {
    const rowObject = {};
    headers.forEach((header, index) => {
      rowObject[header] = row[index] || '';
    });

    return normalizeRecord({
      id: pick(rowObject, ['ID', 'id']),
      callTime: pick(rowObject, ['来电时间', 'callTime']),
      callerName: pick(rowObject, ['来电人姓名', 'callerName']),
      callerUnit: pick(rowObject, ['来电单位', 'callerUnit']),
      phoneNumber: pick(rowObject, ['电话号码', 'phoneNumber']),
      question: pick(rowObject, ['来电问题/诉求', 'question']),
      isResolved: pick(rowObject, ['是否解决', 'isResolved']),
      resolution: pick(rowObject, ['处理结果', 'resolution'])
    });
  });
}

function parseImportContent(content, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content || '');

  if (ext === '.json') {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!Array.isArray(parsed)) {
      throw new Error('JSON 文件必须是记录数组');
    }
    return parsed.map(normalizeRecord);
  }

  if (ext === '.csv') {
    return parseCsvRecords(text);
  }

  throw new Error('仅支持导入 .csv 或 .json 文件');
}

function getCsvFileName(date = new Date()) {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  return `电话记录_${y}${m}${d}.csv`;
}

function getAccessUrls(port = PORT, networkInterfaces = os.networkInterfaces()) {
  const urls = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];

  Object.values(networkInterfaces)
    .flat()
    .filter(Boolean)
    .filter((details) => details.family === 'IPv4' && !details.internal)
    .map((details) => details.address)
    .filter(Boolean)
    .forEach((address) => {
      const url = `http://${address}:${port}`;
      if (!urls.includes(url)) {
        urls.push(url);
      }
    });

  return urls;
}

function createApp(options = {}) {
  const app = express();
  const recordsFile = options.recordsFile || getRecordsFilePath();
  const contactsFile = options.contactsFile || getContactsFilePath();
  const organizationsFile = options.organizationsFile || getOrganizationsFilePath();
  const enforceOrganizations = options.enforceOrganizations ?? (!options.recordsFile || Boolean(options.organizationsFile));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
  });

  ensureRecordsFile(recordsFile);
  ensureContactsFile(contactsFile);
  ensureOrganizationsFile(organizationsFile);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(PUBLIC_DIR, {
    etag: true,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store');
    }
  }));

  app.get('/api/records', (req, res) => {
    try {
      res.json(readRecords(recordsFile).sort(compareByCallTimeDesc));
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/records', (req, res) => {
    try {
      const record = normalizeRecord({
        id: createId(),
        callTime: req.body.callTime,
        callerName: req.body.callerName,
        callerUnit: req.body.callerUnit,
        phoneNumber: req.body.phoneNumber,
        question: req.body.question,
        isResolved: req.body.isResolved,
        resolution: req.body.resolution
      });

      if (!record.callerName || !record.phoneNumber || !record.question) {
        return res.status(400).json({ message: '请填写来电人姓名、电话号码和来电问题/诉求' });
      }

      if (enforceOrganizations && !organizationNameExists(record.callerUnit, organizationsFile)) {
        return res.status(400).json({ message: '请选择已维护的组织机构' });
      }

      const records = readRecords(recordsFile);
      records.push(record);
      writeRecords(records, recordsFile);
      upsertContactByPhone({
        phoneNumber: record.phoneNumber,
        callerUnit: record.callerUnit,
        callerName: record.callerName,
        remark: ''
      }, contactsFile);

      return res.status(201).json(record);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.put('/api/records/:id', (req, res) => {
    try {
      const records = readRecords(recordsFile);
      const index = records.findIndex((record) => record.id === req.params.id);

      if (index === -1) {
        return res.status(404).json({ message: '记录不存在' });
      }

      const updated = normalizeRecord({
        ...records[index],
        isResolved: req.body.isResolved,
        resolution: req.body.resolution
      });

      records[index] = updated;
      writeRecords(records, recordsFile);

      return res.json(updated);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.delete('/api/records/:id', (req, res) => {
    try {
      const result = deleteRecordById(req.params.id, recordsFile);

      if (!result.deleted) {
        return res.status(404).json({ message: '记录不存在' });
      }

      return res.json({
        deleted: result.deleted,
        total: result.records.length
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/contacts', (req, res) => {
    try {
      res.json(syncContactsFromRecords(recordsFile, contactsFile));
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/contact-units', (req, res) => {
    try {
      syncContactsFromRecords(recordsFile, contactsFile);
      res.json(getContactUnitSummaries(recordsFile));
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/contacts/lookup', (req, res) => {
    try {
      const contact = findContactByPhone(req.query.phone, contactsFile);
      res.json({ contact });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/contacts', (req, res) => {
    try {
      const result = upsertContactByPhone({
        phoneNumber: req.body.phoneNumber,
        callerUnit: req.body.callerUnit,
        callerName: req.body.callerName,
        remark: req.body.remark
      }, contactsFile);

      return res.status(result.created ? 201 : 200).json({
        created: result.created,
        contact: result.contact,
        total: result.contacts.length
      });
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
  });

  app.delete('/api/contacts/:id', (req, res) => {
    try {
      const result = deleteContactById(req.params.id, contactsFile);

      if (!result.deleted) {
        return res.status(404).json({ message: '通讯录记录不存在' });
      }

      return res.json({
        deleted: result.deleted,
        total: result.contacts.length
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/organizations', (req, res) => {
    try {
      res.json(readOrganizations(organizationsFile));
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/organizations', (req, res) => {
    try {
      const result = createOrganization({ name: req.body.name }, organizationsFile);
      return res.status(201).json(result);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
  });

  app.put('/api/organizations/:id', (req, res) => {
    try {
      const result = updateOrganizationById(req.params.id, { name: req.body.name }, organizationsFile);
      if (!result.organization) {
        return res.status(404).json({ message: '组织机构不存在' });
      }
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
  });

  app.delete('/api/organizations/:id', (req, res) => {
    try {
      const result = deleteOrganizationById(req.params.id, organizationsFile, recordsFile);
      if (!result.deleted) {
        return res.status(404).json({ message: '组织机构不存在' });
      }
      return res.json(result);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ message: error.message });
    }
  });

  app.get('/api/export/csv', (req, res) => {
    try {
      const csv = recordsToCsv(readRecords(recordsFile));
      const fileName = encodeURIComponent(getCsvFileName());

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
      res.send(csv);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/import', upload.single('file'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: '请选择要导入的文件' });
      }

      const incomingRecords = parseImportContent(req.file.buffer, req.file.originalname);
      const mode = String(req.body.mode || 'merge');
      const nextRecords = mode === 'overwrite'
        ? incomingRecords.sort(compareByCallTimeDesc)
        : mergeRecords(readRecords(recordsFile), incomingRecords);

      writeRecords(nextRecords, recordsFile);

      return res.json({
        imported: incomingRecords.length,
        total: nextRecords.length,
        mode
      });
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
  });

  return app;
}

if (require.main === module) {
  const app = createApp();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`电话记录管理系统已启动，监听端口：${PORT}`);
    console.log('可访问地址：');
    getAccessUrls(PORT).forEach((url) => console.log(`  ${url}`));
    console.log(`数据文件：${getRecordsFilePath()}`);
    console.log('其他电脑请访问上面的局域网地址，所有数据都会写入本机 data\\records.json。');
  });
}

module.exports = {
  compareByCallTimeDesc,
  compareContactsByCallCountDesc,
  createApp,
  createId,
  deleteContactById,
  deleteOrganizationById,
  deleteRecordById,
  ensureContactsFile,
  ensureOrganizationsFile,
  ensureRecordsFile,
  getAccessUrls,
  getContactsFilePath,
  getCsvFileName,
  getContactUnitSummaries,
  getOrganizationsFilePath,
  getRecordsFilePath,
  findContactByPhone,
  applyRecordStatsToContacts,
  createOrganization,
  getContactStatsFromRecords,
  isOrganizationUsed,
  mergeRecords,
  normalizeContact,
  normalizeOrganization,
  normalizeRecord,
  normalizePhoneDigits,
  normalizeStatsUnit,
  organizationNameExists,
  parseCsv,
  parseImportContent,
  readContacts,
  readOrganizations,
  readRecords,
  recordsToCsv,
  syncContactsFromRecords,
  updateOrganizationById,
  upsertContactByPhone,
  writeContacts,
  writeOrganizations,
  writeRecords
};
