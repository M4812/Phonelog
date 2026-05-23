const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('数据文件路径位于当前运行目录的 data/records.json', () => {
  const app = require('../server');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-'));
  const actual = app.getRecordsFilePath(tmpDir);

  assert.equal(actual, path.join(tmpDir, 'data', 'records.json'));
});

test('首次运行会自动创建 records.json 空数组', () => {
  const app = require('../server');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-'));
  const recordsFile = app.getRecordsFilePath(tmpDir);

  const records = app.ensureRecordsFile(recordsFile);

  assert.deepEqual(records, []);
  assert.equal(fs.readFileSync(recordsFile, 'utf8'), '[]');
});

test('CSV 导出包含 BOM 并保留中文字段', () => {
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

test('CSV 导入按 ID 去重合并，后导入内容覆盖同 ID 旧记录', () => {
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

test('前端筛选同时支持姓名、单位、电话、问题模糊搜索和解决状态', () => {
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

test('前端 CSV 导出可只包含选中的记录并带 BOM', () => {
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

test('前端统计包含总问题条数、今日解决情况和全部未解决问题', () => {
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

test('同一分钟内新增的记录按创建时间倒序排在最前面', () => {
  const app = require('../server');
  const olderId = app.createId();
  const newerId = app.createId();
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
  ], path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-')), 'data', 'records.json'));

  assert.deepEqual(records.map((record) => record.id), [newerId, olderId]);
});

test('不同来电时间仍按来电时间倒序排列', () => {
  const app = require('../server');
  const newerId = app.createId();
  const olderId = app.createId();
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
  ], path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-')), 'data', 'records.json'));

  assert.deepEqual(records.map((record) => record.id), [olderId, newerId]);
});

test('删除指定 ID 的记录后会持久化剩余记录', () => {
  const app = require('../server');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-record-app-'));
  const recordsFile = app.getRecordsFilePath(tmpDir);
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

test('启动提示会列出本机和局域网访问地址', () => {
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
