const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function makeTempRecordsFile() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-'));
  return {
    tmpDir,
    recordsFile: path.join(tmpDir, 'data', 'records.json')
  };
}

function makeTempAppFiles() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-'));
  return {
    tmpDir,
    recordsFile: path.join(tmpDir, 'data', 'records.json'),
    contactsFile: path.join(tmpDir, 'data', 'contacts.json'),
    organizationsFile: path.join(tmpDir, 'data', 'organizations.json')
  };
}

function requestJson(server, method, pathname, body) {
  const address = server.address();
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path: pathname,
      headers: payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        : {}
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        const data = raw ? JSON.parse(raw) : null;
        resolve({ statusCode: res.statusCode, data });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

test('data file path is anchored to the server working directory', () => {
  const app = require('../server');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-'));
  const actual = app.getRecordsFilePath(tmpDir);

  assert.equal(actual, path.join(tmpDir, 'data', 'records.json'));
});

test('first run creates an empty records.json file', () => {
  const app = require('../server');
  const { recordsFile } = makeTempRecordsFile();

  const records = app.ensureRecordsFile(recordsFile);

  assert.deepEqual(records, []);
  assert.equal(fs.readFileSync(recordsFile, 'utf8'), '[]');
});

test('API clients from any machine share the same server-side records file', async (t) => {
  const appModule = require('../server');
  const { recordsFile } = makeTempRecordsFile();
  const app = appModule.createApp({ recordsFile });
  const server = app.listen(0, '127.0.0.1');

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const created = await requestJson(server, 'POST', '/api/records', {
    callTime: '2026-05-26 10:30',
    callerName: '张三',
    callerUnit: '办公室',
    phoneNumber: '13800138000',
    question: '咨询业务办理进度',
    isResolved: false,
    resolution: ''
  });

  assert.equal(created.statusCode, 201);

  const localClient = await requestJson(server, 'GET', '/api/records');
  const remoteClient = await requestJson(server, 'GET', '/api/records');

  assert.equal(localClient.statusCode, 200);
  assert.equal(remoteClient.statusCode, 200);
  assert.deepEqual(remoteClient.data, localClient.data);
  assert.equal(remoteClient.data[0].callerName, '张三');
  assert.equal(JSON.parse(fs.readFileSync(recordsFile, 'utf8'))[0].phoneNumber, '13800138000');
});

test('delete persists to the shared server-side records file', () => {
  const app = require('../server');
  const { recordsFile } = makeTempRecordsFile();
  app.writeRecords([
    {
      id: 'delete-me',
      callTime: '2026-05-23 13:00',
      callerName: '待删除',
      phoneNumber: '10000',
      question: '删除测试',
      isResolved: false,
      resolution: ''
    },
    {
      id: 'keep-me',
      callTime: '2026-05-23 13:01',
      callerName: '保留',
      phoneNumber: '10001',
      question: '保留测试',
      isResolved: true,
      resolution: '已处理'
    }
  ], recordsFile);

  const result = app.deleteRecordById('delete-me', recordsFile);
  const remaining = app.readRecords(recordsFile);

  assert.equal(result.deleted.id, 'delete-me');
  assert.deepEqual(remaining.map((record) => record.id), ['keep-me']);
});

test('contacts are persisted to a dedicated contacts.json file', () => {
  const app = require('../server');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-'));
  const contactsFile = app.getContactsFilePath(tmpDir);

  const contacts = app.ensureContactsFile(contactsFile);

  assert.deepEqual(contacts, []);
  assert.equal(contactsFile, path.join(tmpDir, 'data', 'contacts.json'));
  assert.equal(fs.readFileSync(contactsFile, 'utf8'), '[]');
});

test('organizations are persisted to a dedicated organizations.json file', () => {
  const app = require('../server');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-'));
  const organizationsFile = app.getOrganizationsFilePath(tmpDir);

  const organizations = app.ensureOrganizationsFile(organizationsFile);

  assert.deepEqual(organizations, []);
  assert.equal(organizationsFile, path.join(tmpDir, 'data', 'organizations.json'));
  assert.equal(fs.readFileSync(organizationsFile, 'utf8'), '[]');
});

test('organization upsert trims names and rejects duplicate organization names', () => {
  const app = require('../server');
  const { organizationsFile } = makeTempAppFiles();

  const created = app.createOrganization({ name: ' 中心 ' }, organizationsFile);

  assert.equal(created.organization.name, '中心');
  assert.throws(
    () => app.createOrganization({ name: '中心' }, organizationsFile),
    /组织机构已存在/
  );
});

test('organizations API creates, updates, and blocks deleting used organizations', async (t) => {
  const appModule = require('../server');
  const { recordsFile, contactsFile, organizationsFile } = makeTempAppFiles();
  appModule.writeRecords([
    {
      id: 'used-record',
      callTime: '2026-05-26 10:00',
      callerName: '张三',
      callerUnit: '中心',
      phoneNumber: '13800138000',
      question: '已有记录',
      isResolved: true,
      resolution: ''
    }
  ], recordsFile);
  const app = appModule.createApp({ recordsFile, contactsFile, organizationsFile });
  const server = app.listen(0, '127.0.0.1');

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const created = await requestJson(server, 'POST', '/api/organizations', { name: '中心' });
  const updated = await requestJson(server, 'PUT', `/api/organizations/${encodeURIComponent(created.data.organization.id)}`, { name: '中心' });
  const blockedDelete = await requestJson(server, 'DELETE', `/api/organizations/${encodeURIComponent(created.data.organization.id)}`);
  const listed = await requestJson(server, 'GET', '/api/organizations');

  assert.equal(created.statusCode, 201);
  assert.equal(updated.statusCode, 200);
  assert.equal(blockedDelete.statusCode, 409);
  assert.match(blockedDelete.data.message, /已有来电记录/);
  assert.deepEqual(listed.data.map((organization) => organization.name), ['中心']);
});

test('organization test data keeps center, offices, and sections in manager order', () => {
  const app = require('../server');
  const { organizationsFile } = makeTempAppFiles();
  app.writeOrganizations([
    { id: 'org-office-1-section-8', name: '一处八科', createdAt: '2026-05-26 20:00', updatedAt: '2026-05-26 20:00' },
    { id: 'org-office-2-section-1', name: '二处一科', createdAt: '2026-05-26 20:00', updatedAt: '2026-05-26 20:00' },
    { id: 'org-center', name: '中心', createdAt: '2026-05-26 20:00', updatedAt: '2026-05-26 20:00' },
    { id: 'org-office-1', name: '一处', createdAt: '2026-05-26 20:00', updatedAt: '2026-05-26 20:00' },
    { id: 'org-office-1-section-1', name: '一处一科', createdAt: '2026-05-26 20:00', updatedAt: '2026-05-26 20:00' },
    { id: 'org-office-2', name: '二处', createdAt: '2026-05-26 20:00', updatedAt: '2026-05-26 20:00' }
  ], organizationsFile);

  const organizations = app.readOrganizations(organizationsFile);

  assert.deepEqual(organizations.map((organization) => organization.name), [
    '中心',
    '一处',
    '一处一科',
    '一处八科',
    '二处',
    '二处一科'
  ]);
});

test('bundled organization seed data includes center, seven offices, and eight sections per office', () => {
  const app = require('../server');
  const seedFile = path.join(__dirname, '..', 'data', 'organizations.json');
  const names = app.readOrganizations(seedFile).map((organization) => organization.name);
  const expectedNames = ['中心'];
  const numbers = ['一', '二', '三', '四', '五', '六', '七', '八'];

  numbers.slice(0, 7).forEach((officeName) => {
    expectedNames.push(`${officeName}处`);
    numbers.forEach((sectionName) => {
      expectedNames.push(`${officeName}处${sectionName}科`);
    });
  });

  assert.deepEqual(names, expectedNames);
});

test('contact upsert deduplicates by normalized phone and updates existing details', () => {
  const app = require('../server');
  const contactsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-')), 'data', 'contacts.json');

  const first = app.upsertContactByPhone({
    phoneNumber: '138-0013-8000',
    callerUnit: '旧单位',
    callerName: '张三',
    remark: '第一次'
  }, contactsFile);
  const second = app.upsertContactByPhone({
    phoneNumber: '13800138000',
    callerUnit: '新单位',
    callerName: '张三三',
    remark: '更新备注'
  }, contactsFile);
  const contacts = app.readContacts(contactsFile);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].callerUnit, '新单位');
  assert.equal(contacts[0].callerName, '张三三');
  assert.equal(contacts[0].callCount, 2);
});

test('contact lookup matches normalized phone digits for main page linkage', () => {
  const app = require('../server');
  const contactsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-')), 'data', 'contacts.json');
  app.upsertContactByPhone({
    phoneNumber: '010 8888 6666',
    callerUnit: '政务服务中心',
    callerName: '李四'
  }, contactsFile);

  const contact = app.findContactByPhone('010-8888', contactsFile);

  assert.equal(contact.callerUnit, '政务服务中心');
  assert.equal(contact.callerName, '李四');
});

test('contacts API creates, deduplicates, lists, and exposes lookup data', async (t) => {
  const appModule = require('../server');
  const { recordsFile, tmpDir } = makeTempRecordsFile();
  const contactsFile = path.join(tmpDir, 'data', 'contacts.json');
  const app = appModule.createApp({ recordsFile, contactsFile });
  const server = app.listen(0, '127.0.0.1');

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const created = await requestJson(server, 'POST', '/api/contacts', {
    phoneNumber: '138-0013-8000',
    callerUnit: '旧单位',
    callerName: '张三',
    remark: '首次登记'
  });
  const merged = await requestJson(server, 'POST', '/api/contacts', {
    phoneNumber: '13800138000',
    callerUnit: '新单位',
    callerName: '张三三',
    remark: '合并更新'
  });
  const listed = await requestJson(server, 'GET', '/api/contacts');
  const lookup = await requestJson(server, 'GET', '/api/contacts/lookup?phone=1380013');

  assert.equal(created.statusCode, 201);
  assert.equal(merged.statusCode, 200);
  assert.equal(merged.data.created, false);
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].callerUnit, '新单位');
  assert.equal(lookup.statusCode, 200);
  assert.equal(lookup.data.contact.callerName, '张三三');
});

test('contact API clients from any machine share the same server-side contacts file', async (t) => {
  const appModule = require('../server');
  const { recordsFile, tmpDir } = makeTempRecordsFile();
  const contactsFile = path.join(tmpDir, 'data', 'contacts.json');
  const app = appModule.createApp({ recordsFile, contactsFile });
  const server = app.listen(0, '127.0.0.1');

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const clientAWrite = await requestJson(server, 'POST', '/api/contacts', {
    phoneNumber: '13900001111',
    callerUnit: 'A 客户端录入单位',
    callerName: '王五',
    remark: 'A 电脑新增'
  });
  const clientBRead = await requestJson(server, 'GET', '/api/contacts');
  const clientBUpdate = await requestJson(server, 'POST', '/api/contacts', {
    phoneNumber: '139-0000-1111',
    callerUnit: 'B 客户端修改单位',
    callerName: '王五更新',
    remark: 'B 电脑修改'
  });
  const clientAReadAgain = await requestJson(server, 'GET', '/api/contacts');
  const persisted = JSON.parse(fs.readFileSync(contactsFile, 'utf8'));

  assert.equal(clientAWrite.statusCode, 201);
  assert.equal(clientBRead.statusCode, 200);
  assert.equal(clientBRead.data[0].callerUnit, 'A 客户端录入单位');
  assert.equal(clientBUpdate.statusCode, 200);
  assert.equal(clientBUpdate.data.created, false);
  assert.equal(clientAReadAgain.data.length, 1);
  assert.equal(clientAReadAgain.data[0].callerUnit, 'B 客户端修改单位');
  assert.equal(persisted[0].callerName, '王五更新');
});

test('creating a call record automatically upserts the caller into contacts', async (t) => {
  const appModule = require('../server');
  const { recordsFile, contactsFile, organizationsFile } = makeTempAppFiles();
  appModule.createOrganization({ name: '主页单位' }, organizationsFile);
  const app = appModule.createApp({ recordsFile, contactsFile, organizationsFile });
  const server = app.listen(0, '127.0.0.1');

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const createdRecord = await requestJson(server, 'POST', '/api/records', {
    callTime: '2026-05-26 19:10',
    callerName: '主页登记人',
    callerUnit: '主页单位',
    phoneNumber: '188-0000-9999',
    question: '主页新增后同步通讯录',
    isResolved: true,
    resolution: '已处理'
  });
  const contacts = await requestJson(server, 'GET', '/api/contacts');

  assert.equal(createdRecord.statusCode, 201);
  assert.equal(contacts.statusCode, 200);
  assert.equal(contacts.data.length, 1);
  assert.equal(contacts.data[0].phoneNumber, '188-0000-9999');
  assert.equal(contacts.data[0].callerName, '主页登记人');
  assert.equal(contacts.data[0].callerUnit, '主页单位');
});

test('records API rejects caller units that are not in organizations', async (t) => {
  const appModule = require('../server');
  const { recordsFile, contactsFile, organizationsFile } = makeTempAppFiles();
  appModule.createOrganization({ name: '中心' }, organizationsFile);
  const app = appModule.createApp({ recordsFile, contactsFile, organizationsFile });
  const server = app.listen(0, '127.0.0.1');

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const rejected = await requestJson(server, 'POST', '/api/records', {
    callTime: '2026-05-26 19:10',
    callerName: '登记人',
    callerUnit: '未维护单位',
    phoneNumber: '18800009999',
    question: '不允许保存',
    isResolved: true,
    resolution: ''
  });
  const accepted = await requestJson(server, 'POST', '/api/records', {
    callTime: '2026-05-26 19:20',
    callerName: '登记人',
    callerUnit: '中心',
    phoneNumber: '18800009999',
    question: '允许保存',
    isResolved: true,
    resolution: ''
  });

  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.data.message, /请选择已维护的组织机构/);
  assert.equal(accepted.statusCode, 201);
});

test('contacts list backfills existing call record phone numbers', async (t) => {
  const appModule = require('../server');
  const { recordsFile, tmpDir } = makeTempRecordsFile();
  const contactsFile = path.join(tmpDir, 'data', 'contacts.json');
  appModule.writeRecords([
    {
      id: 'existing-record',
      callTime: '2026-05-26 18:48',
      callerName: '历史记录人',
      callerUnit: '历史单位',
      phoneNumber: '17700008888',
      question: '历史记录补同步',
      isResolved: true,
      resolution: ''
    }
  ], recordsFile);

  const app = appModule.createApp({ recordsFile, contactsFile });
  const server = app.listen(0, '127.0.0.1');

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const contacts = await requestJson(server, 'GET', '/api/contacts');

  assert.equal(contacts.statusCode, 200);
  assert.equal(contacts.data.length, 1);
  assert.equal(contacts.data[0].phoneNumber, '17700008888');
  assert.equal(contacts.data[0].callerName, '历史记录人');
});

test('contacts list derives call count and latest registration time from records.json', async (t) => {
  const appModule = require('../server');
  const { recordsFile, tmpDir } = makeTempRecordsFile();
  const contactsFile = path.join(tmpDir, 'data', 'contacts.json');
  appModule.writeContacts([
    {
      id: 'contact-existing',
      phoneNumber: '17612875149',
      callerUnit: '北部基地',
      callerName: '联系人',
      remark: '主动登记',
      callCount: 99,
      updatedAt: '2026-05-01 08:00'
    }
  ], contactsFile);
  appModule.writeRecords([
    {
      id: 'record-old',
      callTime: '2026-05-25 09:30',
      callerName: '联系人',
      callerUnit: '北部基地',
      phoneNumber: '176-1287-5149',
      question: '第一次来电',
      isResolved: true,
      resolution: ''
    },
    {
      id: 'record-latest',
      callTime: '2026-05-26 18:45',
      callerName: '联系人',
      callerUnit: '北部基地',
      phoneNumber: '17612875149',
      question: '最新来电',
      isResolved: false,
      resolution: ''
    },
    {
      id: 'record-other',
      callTime: '2026-05-26 19:20',
      callerName: '其他人',
      callerUnit: '其他单位',
      phoneNumber: '19900001111',
      question: '其他电话',
      isResolved: true,
      resolution: ''
    }
  ], recordsFile);

  const app = appModule.createApp({ recordsFile, contactsFile });
  const server = app.listen(0, '127.0.0.1');

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const contacts = await requestJson(server, 'GET', '/api/contacts');
  const target = contacts.data.find((contact) => contact.phoneDigits === '17612875149');

  assert.equal(contacts.statusCode, 200);
  assert.equal(target.callCount, 2);
  assert.equal(target.updatedAt, '2026-05-26 18:45');
});

test('contacts list sorts by real call count before latest call time', async (t) => {
  const appModule = require('../server');
  const { recordsFile, tmpDir } = makeTempRecordsFile();
  const contactsFile = path.join(tmpDir, 'data', 'contacts.json');
  appModule.writeRecords([
    {
      id: 'a-1',
      callTime: '2026-05-26 08:00',
      callerName: '两次来电',
      callerUnit: '单位A',
      phoneNumber: '10001',
      question: 'A1',
      isResolved: true,
      resolution: ''
    },
    {
      id: 'a-2',
      callTime: '2026-05-26 09:00',
      callerName: '两次来电',
      callerUnit: '单位A',
      phoneNumber: '10001',
      question: 'A2',
      isResolved: true,
      resolution: ''
    },
    {
      id: 'b-1',
      callTime: '2026-05-26 19:00',
      callerName: '一次来电但更晚',
      callerUnit: '单位B',
      phoneNumber: '10002',
      question: 'B1',
      isResolved: true,
      resolution: ''
    },
    {
      id: 'c-1',
      callTime: '2026-05-26 10:00',
      callerName: '同样两次较新',
      callerUnit: '单位C',
      phoneNumber: '10003',
      question: 'C1',
      isResolved: true,
      resolution: ''
    },
    {
      id: 'c-2',
      callTime: '2026-05-26 11:00',
      callerName: '同样两次较新',
      callerUnit: '单位C',
      phoneNumber: '10003',
      question: 'C2',
      isResolved: true,
      resolution: ''
    }
  ], recordsFile);

  const app = appModule.createApp({ recordsFile, contactsFile });
  const server = app.listen(0, '127.0.0.1');

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const contacts = await requestJson(server, 'GET', '/api/contacts');

  assert.equal(contacts.statusCode, 200);
  assert.deepEqual(contacts.data.map((contact) => contact.phoneNumber), ['10003', '10001', '10002']);
  assert.deepEqual(contacts.data.map((contact) => contact.callCount), [2, 2, 1]);
});

test('contacts list counts calls by caller unit for every contact in the same unit', async (t) => {
  const appModule = require('../server');
  const { recordsFile, tmpDir } = makeTempRecordsFile();
  const contactsFile = path.join(tmpDir, 'data', 'contacts.json');
  appModule.writeRecords([
    {
      id: 'unit-a-1',
      callTime: '2026-05-26 08:00',
      callerName: '高天',
      callerUnit: 'A单位',
      phoneNumber: '10001',
      question: '高天第一次来电',
      isResolved: true,
      resolution: ''
    },
    {
      id: 'unit-a-2',
      callTime: '2026-05-26 09:00',
      callerName: '张三',
      callerUnit: 'A单位',
      phoneNumber: '10002',
      question: '张三来电',
      isResolved: true,
      resolution: ''
    },
    {
      id: 'unit-a-3',
      callTime: '2026-05-26 10:00',
      callerName: '高天',
      callerUnit: 'A单位',
      phoneNumber: '10001',
      question: '高天第二次来电',
      isResolved: true,
      resolution: ''
    },
    {
      id: 'unit-b-1',
      callTime: '2026-05-26 20:00',
      callerName: '李四',
      callerUnit: 'B单位',
      phoneNumber: '10003',
      question: 'B单位来电',
      isResolved: true,
      resolution: ''
    }
  ], recordsFile);

  const app = appModule.createApp({ recordsFile, contactsFile });
  const server = app.listen(0, '127.0.0.1');

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const contacts = await requestJson(server, 'GET', '/api/contacts');
  const gaoTian = contacts.data.find((contact) => contact.callerName === '高天');
  const zhangSan = contacts.data.find((contact) => contact.callerName === '张三');
  const liSi = contacts.data.find((contact) => contact.callerName === '李四');

  assert.equal(contacts.statusCode, 200);
  assert.equal(gaoTian.callCount, 3);
  assert.equal(zhangSan.callCount, 3);
  assert.equal(gaoTian.updatedAt, '2026-05-26 10:00');
  assert.equal(zhangSan.updatedAt, '2026-05-26 10:00');
  assert.equal(liSi.callCount, 1);
  assert.deepEqual(contacts.data.slice(0, 2).map((contact) => contact.callerUnit), ['A单位', 'A单位']);
});

test('contact unit summary lists one row per unit with unit name as the second column data', async (t) => {
  const appModule = require('../server');
  const { recordsFile, tmpDir } = makeTempRecordsFile();
  const contactsFile = path.join(tmpDir, 'data', 'contacts.json');
  appModule.writeRecords([
    {
      id: 'center-1',
      callTime: '2026-05-26 08:00',
      callerName: '高天',
      callerUnit: '中心',
      phoneNumber: '17612875149',
      question: '中心第一条',
      isResolved: true,
      resolution: ''
    },
    {
      id: 'center-2',
      callTime: '2026-05-26 09:00',
      callerName: '张三',
      callerUnit: '中心',
      phoneNumber: '17612875150',
      question: '中心第二条',
      isResolved: true,
      resolution: ''
    },
    {
      id: 'office-1',
      callTime: '2026-05-26 10:00',
      callerName: '李四',
      callerUnit: '1处',
      phoneNumber: '17700010001',
      question: '1处第一条',
      isResolved: true,
      resolution: ''
    }
  ], recordsFile);

  const app = appModule.createApp({ recordsFile, contactsFile });
  const server = app.listen(0, '127.0.0.1');

  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const summary = await requestJson(server, 'GET', '/api/contact-units');

  assert.equal(summary.statusCode, 200);
  assert.deepEqual(summary.data.map((unit) => unit.callerUnit), ['中心', '1处']);
  assert.deepEqual(summary.data.map((unit) => unit.callCount), [2, 1]);
  assert.equal(summary.data[0].updatedAt, '2026-05-26 09:00');
  assert.equal(summary.data[0].phoneNumber, '17612875150');
  assert.equal(summary.data[0].callerName, '张三');
});

test('contact unit summary uses the latest caller phone and name from records by unit', () => {
  const app = require('../server');
  const { recordsFile } = makeTempRecordsFile();

  app.writeRecords([
    {
      id: 'center-old',
      callTime: '2026-05-26 08:00',
      callerName: '旧联系人',
      callerUnit: '中心',
      phoneNumber: '17612875149',
      question: '早些时候来电',
      isResolved: true,
      resolution: ''
    },
    {
      id: 'center-latest',
      callTime: '2026-05-26 12:30',
      callerName: '最后联系人',
      callerUnit: '中心',
      phoneNumber: '17612875153',
      question: '最新来电',
      isResolved: false,
      resolution: ''
    }
  ], recordsFile);

  const summary = app.getContactUnitSummaries(recordsFile);

  assert.equal(summary.length, 1);
  assert.equal(summary[0].callerUnit, '中心');
  assert.equal(summary[0].callCount, 2);
  assert.equal(summary[0].updatedAt, '2026-05-26 12:30');
  assert.equal(summary[0].phoneNumber, '17612875153');
  assert.equal(summary[0].callerName, '最后联系人');
});

test('CSV export includes BOM and readable Chinese headers', () => {
  const app = require('../server');
  const csv = app.recordsToCsv([
    {
      id: '1',
      callTime: '2026-05-23 09:30',
      callerName: '张三',
      callerUnit: '财务部',
      phoneNumber: '13800138000',
      question: '咨询业务',
      isResolved: true,
      resolution: '已电话回复'
    }
  ]);

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /来电人姓名/);
  assert.match(csv, /来电单位/);
  assert.match(csv, /财务部/);
  assert.match(csv, /张三/);
  assert.match(csv, /已解决/);
});

test('CSV import merges duplicate IDs and lets the later import win', () => {
  const app = require('../server');
  const existing = [
    {
      id: 'same-id',
      callTime: '2026-05-22 08:00',
      callerName: '旧姓名',
      callerUnit: '旧单位',
      phoneNumber: '10086',
      question: '旧问题',
      isResolved: false,
      resolution: ''
    }
  ];
  const csv = '\ufeffID,来电时间,来电人姓名,来电单位,电话号码,来电问题/诉求,是否解决,处理结果\nsame-id,2026-05-23 10:00,新姓名,新单位,10010,新问题,已解决,新处理';

  const parsed = app.parseImportContent(csv, 'records.csv');
  const merged = app.mergeRecords(existing, parsed);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].callerName, '新姓名');
  assert.equal(merged[0].callerUnit, '新单位');
  assert.equal(merged[0].isResolved, true);
  assert.equal(merged[0].resolution, '新处理');
});

test('frontend filtering supports name, unit, phone, question, and status', () => {
  const { filterRecords } = require('../public/script');
  const sampleRecords = [
    {
      id: '1',
      callerName: '张三',
      callerUnit: '财务部',
      phoneNumber: '13800138000',
      question: '咨询发票',
      isResolved: true
    },
    {
      id: '2',
      callerName: '李四',
      callerUnit: '运维中心',
      phoneNumber: '010-88886666',
      question: '投诉网络故障',
      isResolved: false
    }
  ];

  assert.deepEqual(filterRecords(sampleRecords, '发票', 'all').map((record) => record.id), ['1']);
  assert.deepEqual(filterRecords(sampleRecords, '运维', 'all').map((record) => record.id), ['2']);
  assert.deepEqual(filterRecords(sampleRecords, '8888', 'all').map((record) => record.id), ['2']);
  assert.deepEqual(filterRecords(sampleRecords, '', 'resolved').map((record) => record.id), ['1']);
  assert.deepEqual(filterRecords(sampleRecords, '故障', 'unresolved').map((record) => record.id), ['2']);
});

test('frontend filtering fuzzy matches caller name, caller unit, and normalized phone digits', () => {
  const { filterRecords } = require('../public/script');
  const sampleRecords = [
    {
      id: '1',
      callerName: '张  三',
      callerUnit: '市  政  务 服务中心',
      phoneNumber: '138-0013-8000',
      question: '咨询业务',
      isResolved: true
    },
    {
      id: '2',
      callerName: '李四',
      callerUnit: '运维中心',
      phoneNumber: '010 8888 6666',
      question: '网络故障',
      isResolved: false
    }
  ];

  assert.deepEqual(filterRecords(sampleRecords, '张三', 'all').map((record) => record.id), ['1']);
  assert.deepEqual(filterRecords(sampleRecords, '政务服务', 'all').map((record) => record.id), ['1']);
  assert.deepEqual(filterRecords(sampleRecords, '1380013', 'all').map((record) => record.id), ['1']);
  assert.deepEqual(filterRecords(sampleRecords, '010-8888', 'all').map((record) => record.id), ['2']);
});

test('frontend pagination defaults to 10 items and supports page size changes', () => {
  const { getPagedItems } = require('../public/script');
  const items = Array.from({ length: 25 }, (_, index) => ({ id: String(index + 1) }));

  const firstPage = getPagedItems(items);
  const secondPage = getPagedItems(items, 2, 10);
  const customPageSize = getPagedItems(items, 2, 20);

  assert.deepEqual(firstPage.items.map((item) => item.id), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.deepEqual(secondPage.items.map((item) => item.id), ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20']);
  assert.deepEqual(customPageSize.items.map((item) => item.id), ['21', '22', '23', '24', '25']);
  assert.equal(firstPage.pageCount, 3);
});

test('record field suggestions fuzzy match caller name, caller unit, and phone number', () => {
  const { getRecordFieldSuggestions } = require('../public/script');
  const sampleRecords = [
    {
      id: '1',
      callerName: '高 天',
      callerUnit: '市  政  务 服务中心',
      phoneNumber: '138-0013-8000',
      question: '咨询业务',
      isResolved: true
    },
    {
      id: '2',
      callerName: '李四',
      callerUnit: '运维中心',
      phoneNumber: '010 8888 6666',
      question: '网络故障',
      isResolved: false
    }
  ];

  assert.deepEqual(getRecordFieldSuggestions(sampleRecords, 'callerName', '高天').map((item) => item.value), ['高 天']);
  assert.deepEqual(getRecordFieldSuggestions(sampleRecords, 'callerUnit', '政务服务').map((item) => item.value), ['市  政  务 服务中心']);
  assert.deepEqual(getRecordFieldSuggestions(sampleRecords, 'phoneNumber', '1380013').map((item) => item.value), ['138-0013-8000']);
});

test('record field suggestions include contacts registered in the phone directory', () => {
  const { getRecordFieldSuggestions } = require('../public/script');
  const sampleRecords = [];
  const sampleContacts = [
    {
      id: 'contact-1',
      callerName: '赵六',
      callerUnit: '便民中心',
      phoneNumber: '139-0000-1111'
    }
  ];

  assert.deepEqual(getRecordFieldSuggestions(sampleRecords, 'phoneNumber', '1390000', 6, sampleContacts).map((item) => item.value), ['139-0000-1111']);
  assert.deepEqual(getRecordFieldSuggestions(sampleRecords, 'callerName', '赵六', 6, sampleContacts).map((item) => item.phoneNumber), ['139-0000-1111']);
  assert.deepEqual(getRecordFieldSuggestions(sampleRecords, 'callerUnit', '便民', 6, sampleContacts).map((item) => item.callerName), ['赵六']);
});

test('dashboard metric cards do not render decorative metric icons', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.doesNotMatch(html, /class="metric-icon"/);
  assert.doesNotMatch(html, />Σ<|>↗<|>✓<|>!<\/span>/);
});

test('frontend CSV export can include only selected records and keeps BOM', () => {
  const { buildCsvForRecords } = require('../public/script');
  const csv = buildCsvForRecords([
    {
      id: 'selected-id',
      callTime: '2026-05-23 12:30',
      callerName: '王五',
      callerUnit: '办公室',
      phoneNumber: '12345',
      question: '只导出这一条',
      isResolved: false,
      resolution: ''
    }
  ]);

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /来电单位/);
  assert.match(csv, /办公室/);
  assert.match(csv, /只导出这一条/);
  assert.doesNotMatch(csv, /不应出现/);
});

test('summary counts total, today, today resolved, and all unresolved records', () => {
  const { getSummaryCounts } = require('../public/script');
  const summary = getSummaryCounts([
    {
      id: '1',
      callTime: '2026-05-23 09:00',
      question: '今日已解决问题',
      isResolved: true
    },
    {
      id: '2',
      callTime: '2026-05-23 10:00',
      question: '今日未解决问题',
      isResolved: false
    },
    {
      id: '3',
      callTime: '2026-05-22 10:00',
      question: '历史问题',
      isResolved: false
    }
  ], '2026-05-23');

  assert.deepEqual(summary, {
    totalProblems: 3,
    todayTotal: 2,
    todayResolved: 1,
    totalUnresolved: 2
  });
});

test('new records in the same minute sort by creation order descending', () => {
  const app = require('../server');
  const olderId = app.createId();
  const newerId = app.createId();
  const { recordsFile } = makeTempRecordsFile();

  const records = app.writeRecords([
    {
      id: olderId,
      callTime: '2026-05-23 12:14',
      callerName: '较早记录',
      phoneNumber: '10001',
      question: '较早新增',
      isResolved: false,
      resolution: ''
    },
    {
      id: newerId,
      callTime: '2026-05-23 12:14',
      callerName: '较新记录',
      phoneNumber: '10002',
      question: '较晚新增',
      isResolved: false,
      resolution: ''
    }
  ], recordsFile);

  assert.deepEqual(records.map((record) => record.id), [newerId, olderId]);
});

test('different call times still sort by call time descending', () => {
  const app = require('../server');
  const newerId = app.createId();
  const olderId = app.createId();
  const { recordsFile } = makeTempRecordsFile();

  const records = app.writeRecords([
    {
      id: newerId,
      callTime: '2026-05-23 11:00',
      callerName: '较晚创建但来电时间早',
      phoneNumber: '10001',
      question: '不应排第一',
      isResolved: false,
      resolution: ''
    },
    {
      id: olderId,
      callTime: '2026-05-23 12:00',
      callerName: '来电时间最新',
      phoneNumber: '10002',
      question: '应排第一',
      isResolved: false,
      resolution: ''
    }
  ], recordsFile);

  assert.deepEqual(records.map((record) => record.id), [olderId, newerId]);
});

test('startup URL helper lists local and LAN IPv4 addresses', () => {
  const app = require('../server');
  const addresses = app.getAccessUrls(3000, {
    Ethernet: [
      {
        address: '192.168.1.25',
        family: 'IPv4',
        internal: false
      },
      {
        address: 'fe80::1',
        family: 'IPv6',
        internal: false
      }
    ],
    Loopback: [
      {
        address: '127.0.0.1',
        family: 'IPv4',
        internal: true
      }
    ]
  });

  assert.deepEqual(addresses, [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://192.168.1.25:3000'
  ]);
});

test('HTML ships local assets instead of CDN resources for offline Windows Server use', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/);
  assert.match(html, /id="recordModal"/);
  assert.match(html, /id="organizationModal"/);
  assert.match(html, /id="openOrganizationBtn"/);
  assert.match(html, /data-modal-open/);
  assert.match(html, /href="\/contacts\.html"/);
});

test('contacts page ships local assets and required statistics controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'contacts.html'), 'utf8');
  const toolbar = html.match(/<div class="contacts-toolbar">[\s\S]*?<\/div>\s*<div class="table-wrap/)?.[0] || '';

  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|cdn\.jsdelivr\.net/);
  assert.match(html, /Storage: \.\/data\/contacts\.json/);
  assert.match(html, /id="contactSearch"/);
  assert.match(html, /id="contactsBody"/);
  assert.match(html, /class="btn primary register-problem-btn"/);
  assert.match(html, /class="btn return-records-btn" href="\/"/);
  assert.match(html, />最后来电联系人<\/th>/);
  assert.match(html, />最后来电时间<\/th>/);
  assert.doesNotMatch(html, />联系人姓名<\/th>/);
  assert.doesNotMatch(html, />最后登记时间<\/th>/);
  assert.match(toolbar, /id="contactPageSize"/);
  assert.match(toolbar, /<option value="50" selected>50 条<\/option>/);
  assert.match(toolbar, /id="contactPrevPage"/);
  assert.match(toolbar, /id="contactNextPage"/);
  assert.match(html, /src="\/contacts.js"/);
});

test('main page exposes contact linkage logic by phone number', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');

  assert.match(script, /async function findContactByPhone/);
  assert.match(script, /async function autofillCallerFromContact/);
  assert.match(script, /let contacts = \[\]/);
  assert.match(script, /async function loadContacts/);
  assert.match(script, /\/api\/contacts\/lookup\?phone=/);
});

test('main page ships pagination controls for phone records', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /id="recordPageSize"/);
  assert.match(html, /id="recordPrevPage"/);
  assert.match(html, /id="recordNextPage"/);
  assert.match(html, /id="recordPageInfo"/);
});

test('contacts page uses the shared pagination helper', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'contacts.js'), 'utf8');

  assert.match(script, /function getPagedItems/);
  assert.match(script, /function getPagedItems\(sourceItems, page = 1, pageSize = 50\)/);
  assert.match(script, /contactPageSize/);
  assert.match(script, /contactCurrentPage/);
});

test('server disables static caching so page changes appear after refresh', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(server, /maxAge:\s*0/);
  assert.match(server, /Cache-Control/);
});

test('contacts page gives a restart hint when contact API is missing', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'contacts.js'), 'utf8');

  assert.match(script, /通讯录接口不可用/);
  assert.match(script, /请重启当前 3000 服务/);
});

test('new record modal defaults status to resolved', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /<select id="isResolved" name="isResolved">[\s\S]*<option value="true" selected>已解决<\/option>/);
});

test('new record fields expose suggestion lists for repeated callers', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /id="callerName"[^>]*data-suggestion-field="callerName"/);
  assert.match(html, /id="callerUnit"[^>]*data-organization-field="callerUnit"/);
  assert.match(html, /id="phoneNumber"[^>]*data-suggestion-field="phoneNumber"/);
});

test('frontend organization suggestions fuzzy match unit names', () => {
  const { getOrganizationDisplayName, getOrganizationSuggestions, getOrganizationValidationMessage, isKnownOrganizationName } = require('../public/script');
  const organizations = [
    { id: 'org-center', name: '中心' },
    { id: 'org-office', name: '综合 办公室' },
    { id: 'org-1', name: '1处' },
    { id: 'org-2', name: '2处' },
    { id: 'org-3', name: '3处' },
    { id: 'org-4', name: '4处' },
    { id: 'org-5', name: '5处' },
    { id: 'org-6', name: '6处' },
    { id: 'org-7', name: '7处' },
    { id: 'org-8', name: '8处' }
  ];

  assert.deepEqual(getOrganizationSuggestions(organizations, '中').map((item) => item.name), ['中心']);
  assert.deepEqual(getOrganizationSuggestions(organizations, '综合办公室').map((item) => item.name), ['综合 办公室']);
  assert.equal(getOrganizationSuggestions(organizations, '').length, organizations.length);
  assert.equal(isKnownOrganizationName(organizations, '中心'), true);
  assert.equal(isKnownOrganizationName(organizations, '未维护单位'), false);
  assert.equal(getOrganizationValidationMessage(organizations, '中心'), '');
  assert.equal(getOrganizationValidationMessage(organizations, '未维护单位'), '请选择已维护的组织机构');
  assert.equal(getOrganizationDisplayName({ id: 'org-center', name: '' }), '中心');
  assert.equal(getOrganizationDisplayName({ id: 'org-office-7', name: '' }), '七处');
  assert.equal(getOrganizationDisplayName({ id: 'org-office-1-section-1', name: '' }), '一处一科');
  assert.equal(getOrganizationDisplayName({ id: 'org-office-7-section-8', name: '' }), '七处八科');
});

test('main page script exposes organization management integration', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');

  assert.match(script, /let organizations = \[\]/);
  assert.match(script, /async function loadOrganizations/);
  assert.match(script, /async function saveOrganization/);
  assert.match(script, /async function deleteOrganization/);
  assert.match(script, /input\.matches\('\[data-suggestion-field\], \[data-organization-field\]'\)/);
  assert.match(script, /validateOrganizationInput/);
  assert.match(script, /organizationInput\.addEventListener\('blur'/);
  assert.match(script, /请选择已维护的组织机构/);
});

test('field suggestions can be confirmed with the Tab key', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');

  assert.match(script, /input\.addEventListener\('keydown'/);
  assert.match(script, /event\.key !== 'Tab'/);
  assert.match(script, /acceptFirstSuggestion/);
});

test('modal backdrop clicks do not close record or import modals', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');

  assert.doesNotMatch(script, /recordModal\.addEventListener\('click'/);
  assert.doesNotMatch(script, /importModal\.addEventListener\('click'/);
});

test('resolved status selects expose green and red tone classes', () => {
  const { getResolvedSelectClass, getStatusFilterSelectClass } = require('../public/script');

  assert.equal(getResolvedSelectClass('true'), 'select-resolved');
  assert.equal(getResolvedSelectClass('false'), 'select-unresolved');
  assert.equal(getStatusFilterSelectClass('all'), '');
  assert.equal(getStatusFilterSelectClass('resolved'), 'select-resolved');
  assert.equal(getStatusFilterSelectClass('unresolved'), 'select-unresolved');
});

test('homepage status filter uses the same green and red select tones', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'script.js'), 'utf8');

  assert.match(script, /function updateStatusFilterTone/);
  assert.match(script, /statusFilter\.addEventListener\('change', \(\) => \{/);
  assert.match(script, /updateStatusFilterTone\(\);/);
});

test('homepage status filter uses a refined dropdown style with neutral options', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const statusFilterRule = css.match(/#statusFilter\s*\{[^}]*\}/)?.[0] || '';
  const statusFilterToneRule = css.match(/#statusFilter\.select-resolved,\s*#statusFilter\.select-unresolved\s*\{[^}]*\}/)?.[0] || '';
  const statusFilterOptionRule = css.match(/#statusFilter option\s*\{[^}]*\}/)?.[0] || '';
  const statusFilterOptionCheckedRule = css.match(/#statusFilter option:checked\s*\{[^}]*\}/)?.[0] || '';

  assert.match(statusFilterRule, /border-radius:\s*12px;/);
  assert.match(statusFilterRule, /font-weight:\s*800;/);
  assert.match(statusFilterToneRule, /border-width:\s*1px;/);
  assert.match(statusFilterToneRule, /box-shadow:\s*0 1px 2px rgba\(15, 23, 42, 0\.04\);/);
  assert.match(statusFilterOptionRule, /background:\s*#ffffff;/);
  assert.match(statusFilterOptionRule, /color:\s*var\(--text\);/);
  assert.match(statusFilterOptionCheckedRule, /background:\s*#eef2f7;/);
  assert.match(statusFilterOptionCheckedRule, /color:\s*var\(--text\);/);
});

test('table status selects use refined dropdown options', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const statusSelectRule = css.match(/\.status-select\s*\{[^}]*\}/)?.[0] || '';
  const statusSelectOptionRule = css.match(/\.status-select option\s*\{[^}]*\}/)?.[0] || '';
  const statusSelectOptionCheckedRule = css.match(/\.status-select option:checked\s*\{[^}]*\}/)?.[0] || '';
  const statusSelectToneRule = css.match(/\.status-select\.select-resolved,\s*\.status-select\.select-unresolved\s*\{[^}]*\}/)?.[0] || '';

  assert.match(statusSelectRule, /border-radius:\s*12px;/);
  assert.match(statusSelectRule, /font-weight:\s*800;/);
  assert.match(statusSelectToneRule, /box-shadow:\s*0 1px 2px rgba\(15, 23, 42, 0\.04\)/);
  assert.match(statusSelectOptionRule, /background:\s*#ffffff;/);
  assert.match(statusSelectOptionRule, /color:\s*var\(--text\);/);
  assert.match(statusSelectOptionCheckedRule, /background:\s*#eef2f7;/);
  assert.match(statusSelectOptionCheckedRule, /color:\s*var\(--text\);/);
});

test('new record resolved select keeps green and red status backgrounds', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const isResolvedRule = css.match(/#isResolved\s*\{[^}]*\}/)?.[0] || '';
  const isResolvedToneRule = css.match(/#isResolved\.select-resolved,\s*#isResolved\.select-unresolved\s*\{[^}]*\}/)?.[0] || '';
  const isResolvedOptionRule = css.match(/#isResolved option\s*\{[^}]*\}/)?.[0] || '';
  const isResolvedOptionCheckedRule = css.match(/#isResolved option:checked\s*\{[^}]*\}/)?.[0] || '';

  assert.match(isResolvedRule, /font-weight:\s*800;/);
  assert.match(isResolvedRule, /min-height:\s*46px;/);
  assert.match(isResolvedRule, /border-radius:\s*12px;/);
  assert.match(isResolvedToneRule, /box-shadow:\s*0 1px 2px rgba\(15, 23, 42, 0\.04\);/);
  assert.match(isResolvedOptionRule, /background:\s*#ffffff;/);
  assert.match(isResolvedOptionRule, /color:\s*var\(--text\);/);
  assert.match(isResolvedOptionCheckedRule, /background:\s*#eef2f7;/);
  assert.match(isResolvedOptionCheckedRule, /color:\s*var\(--text\);/);
  assert.doesNotMatch(isResolvedRule, /background-color/i);
  assert.doesNotMatch(css, /#isResolved,\s*#importMode\s*\{[^}]*background-color:\s*#fff/i);
});

test('unresolved rows use a visible light red background on the homepage', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const unresolvedRowRule = css.match(/\.unresolved-row\s*\{[^}]*\}/)?.[0] || '';
  const unresolvedHoverRule = css.match(/\.records-table tbody tr\.unresolved-row:hover\s*\{[^}]*\}/)?.[0] || '';

  assert.match(unresolvedRowRule, /background:\s*var\(--red-soft\);/);
  assert.match(unresolvedHoverRule, /background:\s*#fee2e2;/);
});

test('resolved rows use a light green hover background on the homepage', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const resolvedHoverRule = css.match(/\.records-table tbody tr:not\(\.unresolved-row\):hover\s*\{[^}]*\}/)?.[0] || '';

  assert.match(resolvedHoverRule, /background:\s*var\(--green-soft\);/);
});

test('homepage records table keeps balanced readable columns', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const tableRule = css.match(/\.records-table\s*\{[^}]*\}/)?.[0] || '';
  const phoneColumnRule = css.match(/\.records-table th:nth-child\(5\),\s*\.records-table td:nth-child\(5\)\s*\{[^}]*\}/)?.[0] || '';
  const questionColumnRule = css.match(/\.records-table th:nth-child\(6\),\s*\.records-table td:nth-child\(6\)\s*\{[^}]*\}/)?.[0] || '';
  const textareaRule = css.match(/\.records-table textarea\s*\{[^}]*\}/)?.[0] || '';

  assert.match(tableRule, /table-layout:\s*auto;/);
  assert.match(phoneColumnRule, /width:\s*178px;/);
  assert.match(questionColumnRule, /width:\s*260px;/);
  assert.match(textareaRule, /min-height:\s*64px;/);
  assert.match(textareaRule, /max-height:\s*96px;/);
});

test('contacts page content sections share the same horizontal alignment', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const contactsShellRule = css.match(/\.contacts-page \.app-shell\s*\{[^}]*\}/)?.[0] || '';
  const contactsGridRule = css.match(/\.contacts-grid\s*\{[^}]*\}/)?.[0] || '';
  const contactsHeroRule = css.match(/\.contacts-hero\s*\{[^}]*\}/)?.[0] || '';

  assert.match(contactsShellRule, /max-width:\s*1480px;/);
  assert.match(contactsGridRule, /display:\s*block;/);
  assert.match(contactsHeroRule, /width:\s*100%;/);
});

test('contacts page removes the side contact form and highlights problem registration', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'contacts.html'), 'utf8');

  assert.doesNotMatch(html, /id="contactForm"/);
  assert.doesNotMatch(html, /class="contact-form-card"/);
  assert.match(html, /class="btn primary register-problem-btn"/);
  assert.match(html, /href="\/\?newRecord=1"/);
});

test('contacts page builds unit search links for the main records page', () => {
  const { buildRecordSearchUrl } = require('../public/contacts');

  assert.equal(
    buildRecordSearchUrl({
      callerUnit: '中心',
      callerName: '赵六',
      phoneNumber: '17612875153'
    }),
    '/?search=%E4%B8%AD%E5%BF%83'
  );
});

test('main page reads record search values from URL search params without opening new record modal', () => {
  const { getRecordSearchFromSearchParams } = require('../public/script');

  assert.equal(getRecordSearchFromSearchParams('?search=%E4%B8%AD%E5%BF%83'), '中心');
  assert.equal(getRecordSearchFromSearchParams('?newRecord=1&callerUnit=%E4%B8%AD%E5%BF%83'), '');
});
