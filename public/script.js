let records = [];
const selectedRecordIds = new Set();

function pad(value) {
  return String(value).padStart(2, '0');
}

function toDateTimeLocalValue(date = new Date()) {
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  ].join('T');
}

function normalizeInputDateTime(value) {
  return String(value || '').replace('T', ' ').slice(0, 16);
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// 统计逻辑独立出来，避免 UI 文案变化影响核心数量计算。
function getSummaryCounts(sourceRecords, today = todayString()) {
  const todayRecords = sourceRecords.filter((record) => String(record.callTime || '').startsWith(today));
  const todayResolved = todayRecords.filter((record) => record.isResolved).length;
  const totalUnresolved = sourceRecords.filter((record) => !record.isResolved).length;

  return {
    totalProblems: sourceRecords.length,
    todayTotal: todayRecords.length,
    todayResolved,
    totalUnresolved
  };
}

// 核心筛选逻辑：独立成纯函数，便于浏览器实时筛选和 Node 测试共用。
function filterRecords(sourceRecords, keyword = '', status = 'all') {
  const normalizedKeyword = String(keyword || '').trim().toLowerCase();

  return sourceRecords.filter((record) => {
    const matchesStatus =
      status === 'all' ||
      (status === 'resolved' && record.isResolved) ||
      (status === 'unresolved' && !record.isResolved);

    if (!matchesStatus) {
      return false;
    }

    if (!normalizedKeyword) {
      return true;
    }

    const searchableText = [
      record.callerName,
      record.callerUnit,
      record.phoneNumber,
      record.question
    ].join(' ').toLowerCase();

    return searchableText.includes(normalizedKeyword);
  });
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsvForRecords(sourceRecords) {
  const headers = ['ID', '来电时间', '来电人姓名', '来电单位', '电话号码', '来电问题/诉求', '是否解决', '处理结果'];
  const rows = sourceRecords.map((record) => [
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

// Node 测试环境没有 document，导出纯函数后直接结束，避免访问 DOM。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildCsvForRecords, filterRecords, getSummaryCounts };
}

if (typeof document !== 'undefined') {
  const recordForm = document.getElementById('recordForm');
  const importForm = document.getElementById('importForm');
  const recordsBody = document.getElementById('recordsBody');
  const formStatus = document.getElementById('formStatus');
  const importStatus = document.getElementById('importStatus');
  const recordCount = document.getElementById('recordCount');
  const resetFormBtn = document.getElementById('resetFormBtn');
  const searchInput = document.getElementById('searchInput');
  const statusFilter = document.getElementById('statusFilter');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const selectAllRecords = document.getElementById('selectAllRecords');
  const recordModalElement = document.getElementById('recordModal');

  function getRecordModal() {
    if (!recordModalElement || typeof bootstrap === 'undefined') {
      return null;
    }

    return bootstrap.Modal.getOrCreateInstance(recordModalElement);
  }

  function setDefaultCallTime() {
    document.getElementById('callTime').value = toDateTimeLocalValue();
  }

  function setStatus(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('text-danger', isError);
    element.classList.toggle('text-muted', !isError);
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || '请求失败');
    }

    return data;
  }

  function getVisibleRecords() {
    return filterRecords(records, searchInput.value, statusFilter.value);
  }

  function getSelectedRecords() {
    return records.filter((record) => selectedRecordIds.has(record.id));
  }

  function updateSelectAllState() {
    const visibleRecords = getVisibleRecords();
    if (!selectAllRecords) {
      return;
    }

    const selectedVisibleCount = visibleRecords.filter((record) => selectedRecordIds.has(record.id)).length;
    selectAllRecords.checked = visibleRecords.length > 0 && selectedVisibleCount === visibleRecords.length;
    selectAllRecords.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleRecords.length;
    selectAllRecords.disabled = visibleRecords.length === 0;
  }

  function updateSummary() {
    const summary = getSummaryCounts(records);
    const visibleCount = getVisibleRecords().length;

    document.getElementById('totalProblems').textContent = summary.totalProblems;
    document.getElementById('todayTotal').textContent = summary.todayTotal;
    document.getElementById('todayResolved').textContent = summary.todayResolved;
    // 兼容原有 DOM id：页面文案已改为“未解决的问题”，这里统计全部历史未解决。
    document.getElementById('todayUnresolved').textContent = summary.totalUnresolved;
    recordCount.textContent = `显示 ${visibleCount} 条 / 共 ${records.length} 条，已选 ${selectedRecordIds.size} 条`;
    updateSelectAllState();
  }

  function createCell(text, className = '') {
    const cell = document.createElement('td');
    cell.textContent = text || '';
    if (className) {
      cell.className = className;
    }
    return cell;
  }

  function createStatusBadge(record) {
    const badge = document.createElement('span');
    badge.className = `badge ${record.isResolved ? 'bg-success' : 'bg-danger'}`;
    badge.textContent = record.isResolved ? '已解决' : '未解决';
    return badge;
  }

  function createStatusSelect(record) {
    const select = document.createElement('select');
    select.className = 'form-select form-select-sm status-select js-status';

    const unresolved = document.createElement('option');
    unresolved.value = 'false';
    unresolved.textContent = '未解决';

    const resolved = document.createElement('option');
    resolved.value = 'true';
    resolved.textContent = '已解决';

    select.append(unresolved, resolved);
    select.value = String(Boolean(record.isResolved));
    return select;
  }

  function renderEmptyRow(message, isError = false) {
    const row = document.createElement('tr');
    const cell = createCell(message, `text-center ${isError ? 'text-danger' : 'text-muted'} py-4`);
    cell.colSpan = 9;
    row.appendChild(cell);
    recordsBody.appendChild(row);
  }

  function renderRecords() {
    const visibleRecords = getVisibleRecords();
    recordsBody.innerHTML = '';

    if (records.length === 0) {
      renderEmptyRow('暂无记录');
      updateSummary();
      return;
    }

    if (visibleRecords.length === 0) {
      renderEmptyRow('没有匹配的记录');
      updateSummary();
      return;
    }

    visibleRecords.forEach((record) => {
      const row = document.createElement('tr');
      row.dataset.id = record.id;
      if (!record.isResolved) {
        row.classList.add('unresolved-row');
      }

      const selectCell = document.createElement('td');
      selectCell.className = 'select-column';
      const rowCheckbox = document.createElement('input');
      rowCheckbox.type = 'checkbox';
      rowCheckbox.className = 'form-check-input js-select-record';
      rowCheckbox.setAttribute('aria-label', `选择记录 ${record.callerName || record.phoneNumber || record.id}`);
      rowCheckbox.checked = selectedRecordIds.has(record.id);
      selectCell.appendChild(rowCheckbox);

      const statusCell = document.createElement('td');
      const statusStack = document.createElement('div');
      statusStack.className = 'd-grid gap-2';
      statusStack.append(createStatusBadge(record), createStatusSelect(record));
      statusCell.appendChild(statusStack);

      const resolutionCell = document.createElement('td');
      const resolutionInput = document.createElement('textarea');
      resolutionInput.className = 'form-control form-control-sm js-resolution';
      resolutionInput.rows = 3;
      resolutionInput.value = record.resolution || '';
      resolutionCell.appendChild(resolutionInput);

      const actionCell = document.createElement('td');
      actionCell.className = 'text-end';
      const actionStack = document.createElement('div');
      actionStack.className = 'row-actions';
      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.className = 'btn btn-sm btn-outline-primary js-save-row';
      saveButton.textContent = '保存';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn btn-sm btn-outline-danger js-delete-row';
      deleteButton.textContent = '删除';
      actionStack.append(saveButton, deleteButton);
      actionCell.appendChild(actionStack);

      row.append(
        selectCell,
        createCell(record.callTime),
        createCell(record.callerName),
        createCell(record.callerUnit || '-', 'unit-cell'),
        createCell(record.phoneNumber),
        createCell(record.question, 'question-cell'),
        statusCell,
        resolutionCell,
        actionCell
      );

      recordsBody.appendChild(row);
    });

    updateSummary();
  }

  async function loadRecords() {
    recordsBody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">正在加载...</td></tr>';
    records = await fetchJson('/api/records');
    const existingIds = new Set(records.map((record) => record.id));
    Array.from(selectedRecordIds).forEach((id) => {
      if (!existingIds.has(id)) {
        selectedRecordIds.delete(id);
      }
    });
    renderRecords();
  }

  recordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(formStatus, '正在保存...');

    const formData = new FormData(recordForm);
    const payload = {
      callTime: normalizeInputDateTime(formData.get('callTime')),
      callerName: formData.get('callerName'),
      callerUnit: formData.get('callerUnit'),
      phoneNumber: formData.get('phoneNumber'),
      question: formData.get('question'),
      isResolved: formData.get('isResolved') === 'true',
      resolution: formData.get('resolution')
    };

    try {
      await fetchJson('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      recordForm.reset();
      setDefaultCallTime();
      setStatus(formStatus, '已保存');
      getRecordModal()?.hide();
      await loadRecords();
    } catch (error) {
      setStatus(formStatus, error.message, true);
    }
  });

  resetFormBtn.addEventListener('click', () => {
    window.setTimeout(setDefaultCallTime, 0);
    setStatus(formStatus, '');
  });

  recordsBody.addEventListener('click', async (event) => {
    if (event.target.classList.contains('js-select-record')) {
      const row = event.target.closest('tr');
      const id = row.dataset.id;

      if (event.target.checked) {
        selectedRecordIds.add(id);
      } else {
        selectedRecordIds.delete(id);
      }

      updateSummary();
      return;
    }

    if (event.target.classList.contains('js-delete-row')) {
      const row = event.target.closest('tr');
      const id = row.dataset.id;
      const record = records.find((item) => item.id === id);
      const label = record?.callerName || record?.phoneNumber || id;

      if (!confirm(`确定删除这条记录吗？\n${label}`)) {
        return;
      }

      const button = event.target;
      button.disabled = true;
      button.textContent = '删除中';

      try {
        await fetchJson(`/api/records/${encodeURIComponent(id)}`, {
          method: 'DELETE'
        });
        selectedRecordIds.delete(id);
        await loadRecords();
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
        button.textContent = '删除';
      }
      return;
    }

    if (!event.target.classList.contains('js-save-row')) {
      return;
    }

    const row = event.target.closest('tr');
    const id = row.dataset.id;
    const button = event.target;
    const payload = {
      isResolved: row.querySelector('.js-status').value === 'true',
      resolution: row.querySelector('.js-resolution').value
    };

    button.disabled = true;
    button.textContent = '保存中';

    try {
      await fetchJson(`/api/records/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      await loadRecords();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
      button.textContent = '保存';
    }
  });

  recordsBody.addEventListener('change', (event) => {
    if (!event.target.classList.contains('js-status')) {
      return;
    }

    const row = event.target.closest('tr');
    row.classList.toggle('unresolved-row', event.target.value !== 'true');
  });

  importForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(importStatus, '正在导入...');

    try {
      const response = await fetch('/api/import', {
        method: 'POST',
        body: new FormData(importForm)
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || '导入失败');
      }

      importForm.reset();
      setStatus(importStatus, `导入 ${data.imported} 条，当前共 ${data.total} 条`);
      await loadRecords();
    } catch (error) {
      setStatus(importStatus, error.message, true);
    }
  });

  // 查询区事件：输入或切换状态时直接重绘当前前端数据，不刷新页面。
  searchInput.addEventListener('input', renderRecords);
  statusFilter.addEventListener('change', renderRecords);

  selectAllRecords?.addEventListener('change', () => {
    const visibleRecords = getVisibleRecords();
    if (selectAllRecords.checked) {
      visibleRecords.forEach((record) => selectedRecordIds.add(record.id));
    } else {
      visibleRecords.forEach((record) => selectedRecordIds.delete(record.id));
    }
    renderRecords();
  });

  exportCsvBtn.addEventListener('click', (event) => {
    event.preventDefault();

    const selectedRecords = getSelectedRecords();
    if (selectedRecords.length === 0) {
      alert('请先勾选要导出的记录，或点击表头复选框全选当前列表。');
      return;
    }

    const blob = new Blob([buildCsvForRecords(selectedRecords)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateText = todayString().replaceAll('-', '');

    link.href = url;
    link.download = `电话记录_已选_${dateText}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  recordModalElement?.addEventListener('shown.bs.modal', () => {
    setDefaultCallTime();
    document.getElementById('callerName').focus();
  });

  document.addEventListener('DOMContentLoaded', () => {
    setDefaultCallTime();
    loadRecords().catch((error) => {
      recordsBody.innerHTML = '';
      renderEmptyRow(error.message, true);
    });
  });
}
