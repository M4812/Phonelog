const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const PORT = Number(process.env.PORT || 3000);
let lastIdMillis = 0;
let idSequence = 0;

// 静态资源必须使用 __dirname，便于 pkg 将 public 打包到二进制程序内部。
const PUBLIC_DIR = path.join(__dirname, 'public');

// 动态数据必须使用 process.cwd()，确保打包后的程序在运行目录旁边读写 data/records.json。
function getRecordsFilePath(baseDir = process.cwd()) {
  return path.join(baseDir, 'data', 'records.json');
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

function readRecords(recordsFile = getRecordsFilePath()) {
  return ensureRecordsFile(recordsFile);
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
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
  });

  // 服务启动时立即初始化数据文件，避免首次访问才暴露目录问题。
  ensureRecordsFile(recordsFile);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(PUBLIC_DIR));

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

      const records = readRecords(recordsFile);
      records.push(record);
      writeRecords(records, recordsFile);

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
  });
}

module.exports = {
  compareByCallTimeDesc,
  createApp,
  createId,
  deleteRecordById,
  ensureRecordsFile,
  getAccessUrls,
  getCsvFileName,
  getRecordsFilePath,
  mergeRecords,
  normalizeRecord,
  parseCsv,
  parseImportContent,
  readRecords,
  recordsToCsv,
  writeRecords
};
