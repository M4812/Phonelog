let records = [];
let contacts = [];
let organizations = [];
const selectedRecordIds = new Set();
let recordCurrentPage = 1;

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

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function recordFieldMatches(field, recordValue, keyword) {
  const text = String(recordValue || '').trim();
  const normalizedKeyword = String(keyword || '').trim().toLowerCase();
  if (!text || !normalizedKeyword) {
    return false;
  }

  if (field === 'phoneNumber') {
    return normalizePhoneDigits(text).includes(normalizePhoneDigits(keyword));
  }

  return text.toLowerCase().includes(normalizedKeyword) ||
    normalizeSearchText(text).includes(normalizeSearchText(keyword));
}

function getRecordFieldSuggestions(sourceRecords, field, keyword, limit = 6, sourceContacts = []) {
  const seenValues = new Set();
  const suggestions = [];

  [...sourceContacts, ...sourceRecords].forEach((record) => {
    const value = String(record?.[field] || '').trim();
    if (!value || seenValues.has(value) || !recordFieldMatches(field, value, keyword)) {
      return;
    }

    seenValues.add(value);
    suggestions.push({
      value,
      callerName: record.callerName || '',
      callerUnit: record.callerUnit || '',
      phoneNumber: record.phoneNumber || ''
    });
  });

  return suggestions.slice(0, limit);
}

function getOrganizationSuggestions(sourceOrganizations, keyword, limit = Infinity) {
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) {
    return sourceOrganizations.slice(0, limit);
  }

  return sourceOrganizations
    .filter((organization) => normalizeSearchText(getOrganizationDisplayName(organization)).includes(normalizedKeyword))
    .slice(0, limit);
}

function isKnownOrganizationName(sourceOrganizations, value) {
  const normalizedValue = normalizeSearchText(value);
  return Boolean(normalizedValue) && sourceOrganizations.some((organization) => normalizeSearchText(getOrganizationDisplayName(organization)) === normalizedValue);
}

function getOrganizationValidationMessage(sourceOrganizations, value) {
  const text = String(value || '').trim();
  if (!text || isKnownOrganizationName(sourceOrganizations, text)) {
    return '';
  }
  return '请选择已维护的组织机构';
}

const CHINESE_ORGANIZATION_NUMBERS = ['零', '一', '二', '三', '四', '五', '六', '七', '八'];

function getOrganizationDisplayName(organization) {
  const explicitName = String(organization?.name || '').trim();
  if (explicitName) {
    return explicitName;
  }

  const sectionMatch = String(organization?.id || '').match(/^org-office-([1-7])-section-([1-8])$/);
  if (sectionMatch) {
    const office = Number(sectionMatch[1]);
    const section = Number(sectionMatch[2]);
    return `${CHINESE_ORGANIZATION_NUMBERS[office]}处${CHINESE_ORGANIZATION_NUMBERS[section]}科`;
  }

  const fallbackNames = {
    'org-center': '中心',
    'org-office-1': '一处',
    'org-office-2': '二处',
    'org-office-3': '三处',
    'org-office-4': '四处',
    'org-office-5': '五处',
    'org-office-6': '六处',
    'org-office-7': '七处'
  };

  return fallbackNames[String(organization?.id || '')] || '';
}

function filterRecords(sourceRecords, keyword = '', status = 'all') {
  const normalizedKeyword = String(keyword || '').trim().toLowerCase();
  const compactKeyword = normalizeSearchText(keyword);
  const keywordDigits = normalizePhoneDigits(keyword);

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
    const compactCallerText = [
      record.callerName,
      record.callerUnit
    ].map(normalizeSearchText).join(' ');
    const phoneDigits = normalizePhoneDigits(record.phoneNumber);

    return searchableText.includes(normalizedKeyword) ||
      (compactKeyword && compactCallerText.includes(compactKeyword)) ||
      (keywordDigits && phoneDigits.includes(keywordDigits));
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

function getResolvedSelectClass(value) {
  return String(value) === 'true' ? 'select-resolved' : 'select-unresolved';
}

function getStatusFilterSelectClass(value) {
  if (value === 'resolved') {
    return 'select-resolved';
  }
  if (value === 'unresolved') {
    return 'select-unresolved';
  }
  return '';
}

function getPagedItems(sourceItems, page = 1, pageSize = 10) {
  const safePageSize = Math.max(1, Number(pageSize) || 10);
  const pageCount = Math.max(1, Math.ceil(sourceItems.length / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const start = (safePage - 1) * safePageSize;

  return {
    items: sourceItems.slice(start, start + safePageSize),
    page: safePage,
    pageCount,
    pageSize: safePageSize,
    total: sourceItems.length
  };
}

function getRecordPrefillFromSearchParams(search = '') {
  const params = new URLSearchParams(search);
  const callerUnit = String(params.get('callerUnit') || '').trim();

  return {
    shouldOpen: params.get('newRecord') === '1',
    ...(callerUnit ? { callerUnit } : {})
  };
}

function getRecordSearchFromSearchParams(search = '') {
  return String(new URLSearchParams(search).get('search') || '').trim();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildCsvForRecords, filterRecords, getOrganizationDisplayName, getOrganizationSuggestions, getOrganizationValidationMessage, getPagedItems, getRecordFieldSuggestions, getRecordPrefillFromSearchParams, getRecordSearchFromSearchParams, getResolvedSelectClass, getStatusFilterSelectClass, getSummaryCounts, isKnownOrganizationName };
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
  const recordPageSize = document.getElementById('recordPageSize');
  const recordPrevPage = document.getElementById('recordPrevPage');
  const recordNextPage = document.getElementById('recordNextPage');
  const recordPageInfo = document.getElementById('recordPageInfo');
  const recordModal = document.getElementById('recordModal');
  const importModal = document.getElementById('importModal');
  const organizationModal = document.getElementById('organizationModal');
  const openImportBtn = document.getElementById('openImportBtn');
  const openOrganizationBtn = document.getElementById('openOrganizationBtn');
  const organizationForm = document.getElementById('organizationForm');
  const organizationName = document.getElementById('organizationName');
  const organizationList = document.getElementById('organizationList');
  const organizationStatus = document.getElementById('organizationStatus');
  const suggestionInputs = Array.from(document.querySelectorAll('[data-suggestion-field]'));
  const organizationInput = document.querySelector('[data-organization-field]');

  function openModal(modal) {
    modal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeModal(modal) {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function setDefaultCallTime() {
    document.getElementById('callTime').value = toDateTimeLocalValue();
    document.getElementById('isResolved').value = 'true';
    updateResolvedSelectTone(document.getElementById('isResolved'));
  }

  function applyRecordPrefill(prefill) {
    if (prefill.callerUnit) {
      document.getElementById('callerUnit').value = prefill.callerUnit;
    }
  }

  function updateResolvedSelectTone(select) {
    select.classList.remove('select-resolved', 'select-unresolved');
    select.classList.add(getResolvedSelectClass(select.value));
  }

  function updateStatusFilterTone() {
    statusFilter.classList.remove('select-resolved', 'select-unresolved');
    const className = getStatusFilterSelectClass(statusFilter.value);
    if (className) {
      statusFilter.classList.add(className);
    }
  }

  function setStatus(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error-text', isError);
  }

  function setOrganizationStatus(message, isError = false) {
    organizationStatus.textContent = message;
    organizationStatus.classList.toggle('error-text', isError);
  }

  function validateOrganizationInput(input) {
    const message = getOrganizationValidationMessage(organizations, input.value);
    if (message) {
      setStatus(formStatus, message, true);
      return false;
    }

    if (formStatus.textContent === '请选择已维护的组织机构') {
      setStatus(formStatus, '');
    }
    return true;
  }

  function hideSuggestionList(input) {
    const list = document.getElementById(`${input.id}Suggestions`);
    if (list) {
      list.hidden = true;
      list.innerHTML = '';
    }
  }

  function ensureSuggestionList(input) {
    const listId = `${input.id}Suggestions`;
    let list = document.getElementById(listId);

    if (!list) {
      list = document.createElement('div');
      list.id = listId;
      list.className = 'suggestion-list';
      list.hidden = true;
      input.insertAdjacentElement('afterend', list);
    }

    return list;
  }

  function renderSuggestionList(input) {
    const field = input.dataset.suggestionField;
  const suggestions = getRecordFieldSuggestions(records, field, input.value, 6, contacts);
    const list = ensureSuggestionList(input);
    list.innerHTML = '';

    if (suggestions.length === 0) {
      list.hidden = true;
      return;
    }

    suggestions.forEach((suggestion) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'suggestion-item';
      button.dataset.value = suggestion.value;

      const valueText = document.createElement('strong');
      valueText.textContent = suggestion.value;

      const metaText = document.createElement('span');
      metaText.textContent = [suggestion.callerName, suggestion.callerUnit, suggestion.phoneNumber]
        .filter(Boolean)
        .join(' / ');

      button.append(valueText, metaText);
      list.appendChild(button);
    });

    list.hidden = false;
  }

  function hideAllSuggestionLists() {
    [...suggestionInputs, organizationInput].filter(Boolean).forEach(hideSuggestionList);
  }

  function acceptFirstSuggestion(input) {
    const list = document.getElementById(`${input.id}Suggestions`);
    const firstItem = list?.querySelector('.suggestion-item');

    if (!firstItem || list.hidden) {
      return false;
    }

    input.value = firstItem.dataset.value || '';
    hideSuggestionList(input);

    const matchedContact = contacts.find((contact) => {
      if (input.dataset.suggestionField === 'phoneNumber') {
        return normalizePhoneDigits(contact.phoneNumber) === normalizePhoneDigits(input.value);
      }
      return String(contact[input.dataset.suggestionField] || '').trim() === input.value;
    });

    if (matchedContact) {
      fillCallerFromContact(matchedContact, true);
    }

    return true;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store',
      ...options
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || '请求失败');
    }

    return data;
  }

  async function findContactByPhone(phoneNumber) {
    const phoneDigits = normalizePhoneDigits(phoneNumber);
    if (!phoneDigits) {
      return null;
    }

    const data = await fetchJson(`/api/contacts/lookup?phone=${encodeURIComponent(phoneNumber)}`);
    return data.contact || null;
  }

  function fillCallerFromContact(contact, force = false) {
    const phoneInput = document.getElementById('phoneNumber');
    const callerUnitInput = document.getElementById('callerUnit');
    const callerNameInput = document.getElementById('callerName');

    if (contact.phoneNumber && (force || !phoneInput.value.trim())) {
      phoneInput.value = contact.phoneNumber;
    }
    if (contact.callerUnit && (force || !callerUnitInput.value.trim())) {
      callerUnitInput.value = contact.callerUnit;
    }
    if (contact.callerName && (force || !callerNameInput.value.trim())) {
      callerNameInput.value = contact.callerName;
    }
  }

  async function autofillCallerFromContact(phoneNumber) {
    const contact = await findContactByPhone(phoneNumber);
    if (!contact) {
      return false;
    }

    // 主页面联动接口：管理员输入来电电话后，按通讯录 JSON 查询历史联系人。
    // 命中时自动填充单位和姓名；如果用户已经手动输入，则不强行覆盖，避免误改。
    fillCallerFromContact(contact);
    return true;
  }

  async function loadContacts() {
    contacts = await fetchJson('/api/contacts');
  }

  async function loadOrganizations() {
    organizations = await fetchJson('/api/organizations');
    renderOrganizations();
  }

  async function saveOrganization(id, name) {
    const url = id ? `/api/organizations/${encodeURIComponent(id)}` : '/api/organizations';
    const result = await fetchJson(url, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    organizations = result.organizations;
    renderOrganizations();
    return result;
  }

  async function deleteOrganization(id) {
    const result = await fetchJson(`/api/organizations/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    organizations = result.organizations;
    renderOrganizations();
    return result;
  }

  function renderOrganizationSuggestionList(input) {
    const suggestions = getOrganizationSuggestions(organizations, input.value);
    const list = ensureSuggestionList(input);
    list.innerHTML = '';

    if (suggestions.length === 0) {
      list.hidden = true;
      return;
    }

    suggestions.forEach((organization) => {
      const organizationName = getOrganizationDisplayName(organization);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'suggestion-item organization-suggestion-item';
      button.dataset.value = organizationName;

      const valueText = document.createElement('strong');
      valueText.textContent = organizationName;
      button.appendChild(valueText);
      list.appendChild(button);
    });

    list.hidden = false;
  }

  function renderOrganizations() {
    organizationList.innerHTML = '';

    if (organizations.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'organization-empty';
      empty.textContent = '暂无组织机构';
      organizationList.appendChild(empty);
      return;
    }

    organizations.forEach((organization) => {
      const organizationName = getOrganizationDisplayName(organization);
      const row = document.createElement('div');
      row.className = 'organization-row';
      row.dataset.id = organization.id;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = organizationName;
      input.setAttribute('value', organizationName);
      input.maxLength = 100;

      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.className = 'row-btn js-save-organization';
      saveButton.textContent = '保存';

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'row-btn danger js-delete-organization';
      deleteButton.textContent = '删除';

      row.append(input, saveButton, deleteButton);
      organizationList.appendChild(row);
    });
  }

  function getVisibleRecords() {
    return filterRecords(records, searchInput.value, statusFilter.value);
  }

  function getRecordPage() {
    return getPagedItems(getVisibleRecords(), recordCurrentPage, recordPageSize.value);
  }

  function getSelectedRecords() {
    return records.filter((record) => selectedRecordIds.has(record.id));
  }

  function updateSelectAllState() {
    const visibleRecords = getRecordPage().items;
    const selectedVisibleCount = visibleRecords.filter((record) => selectedRecordIds.has(record.id)).length;

    selectAllRecords.checked = visibleRecords.length > 0 && selectedVisibleCount === visibleRecords.length;
    selectAllRecords.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleRecords.length;
    selectAllRecords.disabled = visibleRecords.length === 0;
  }

  function updateSummary() {
    const summary = getSummaryCounts(records);
    const visibleCount = getVisibleRecords().length;
    const page = getRecordPage();

    document.getElementById('totalProblems').textContent = summary.totalProblems;
    document.getElementById('todayTotal').textContent = summary.todayTotal;
    document.getElementById('todayResolved').textContent = summary.todayResolved;
    document.getElementById('todayUnresolved').textContent = summary.totalUnresolved;
    recordCount.textContent = `显示 ${visibleCount} 条 / 共 ${records.length} 条，已选 ${selectedRecordIds.size} 条`;
    recordCurrentPage = page.page;
    recordPageInfo.textContent = `第 ${page.page} / ${page.pageCount} 页`;
    recordPrevPage.disabled = page.page <= 1;
    recordNextPage.disabled = page.page >= page.pageCount;
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

  function createStatusSelect(record) {
    const select = document.createElement('select');
    select.className = 'status-select js-status';

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
    const cell = createCell(message, `empty-cell${isError ? ' error-text' : ''}`);
    cell.colSpan = 9;
    row.appendChild(cell);
    recordsBody.appendChild(row);
  }

  function renderRecords() {
    const visibleRecords = getRecordPage().items;
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
      row.classList.toggle('unresolved-row', !record.isResolved);

      const selectCell = document.createElement('td');
      selectCell.className = 'check-col';
      const rowCheckbox = document.createElement('input');
      rowCheckbox.type = 'checkbox';
      rowCheckbox.className = 'js-select-record';
      rowCheckbox.setAttribute('aria-label', `选择记录 ${record.callerName || record.phoneNumber || record.id}`);
      rowCheckbox.checked = selectedRecordIds.has(record.id);
      selectCell.appendChild(rowCheckbox);

      const statusCell = document.createElement('td');
      statusCell.appendChild(createStatusSelect(record));

      const resolutionCell = document.createElement('td');
      const resolutionInput = document.createElement('textarea');
      resolutionInput.className = 'js-resolution';
      resolutionInput.rows = 3;
      resolutionInput.value = record.resolution || '';
      resolutionCell.appendChild(resolutionInput);

      const actionCell = document.createElement('td');
      const actionStack = document.createElement('div');
      actionStack.className = 'row-actions';
      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.className = 'row-btn js-save-row';
      saveButton.textContent = '保存';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'row-btn danger js-delete-row';
      deleteButton.textContent = '删除';
      actionStack.append(saveButton, deleteButton);
      actionCell.appendChild(actionStack);

      row.append(
        selectCell,
        createCell(record.callTime),
        createCell(record.callerName),
        createCell(record.callerUnit || '-', 'muted-cell'),
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
    recordsBody.innerHTML = '<tr><td colspan="9" class="empty-cell">正在加载...</td></tr>';
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

    const callerUnitInput = document.getElementById('callerUnit');
    if (!validateOrganizationInput(callerUnitInput)) {
      callerUnitInput.focus();
      renderOrganizationSuggestionList(callerUnitInput);
      return;
    }

    try {
      await fetchJson('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      recordForm.reset();
      setDefaultCallTime();
      setStatus(formStatus, '');
      closeModal(recordModal);
      await loadRecords();
    } catch (error) {
      setStatus(formStatus, error.message, true);
    }
  });

  resetFormBtn.addEventListener('click', () => {
    window.setTimeout(setDefaultCallTime, 0);
    setStatus(formStatus, '');
    hideAllSuggestionLists();
  });

  suggestionInputs.forEach((input) => {
    input.addEventListener('input', () => renderSuggestionList(input));
    input.addEventListener('focus', () => renderSuggestionList(input));
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') {
        return;
      }

      acceptFirstSuggestion(input);
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => hideSuggestionList(input), 120);
    });
  });

  if (organizationInput) {
    organizationInput.addEventListener('input', () => renderOrganizationSuggestionList(organizationInput));
    organizationInput.addEventListener('focus', () => renderOrganizationSuggestionList(organizationInput));
    organizationInput.addEventListener('blur', () => {
      window.setTimeout(() => {
        validateOrganizationInput(organizationInput);
        hideSuggestionList(organizationInput);
      }, 120);
    });
  }

  document.getElementById('phoneNumber').addEventListener('blur', (event) => {
    autofillCallerFromContact(event.target.value).catch(() => {});
  });

  recordForm.addEventListener('click', (event) => {
    const item = event.target.closest('.suggestion-item');
    if (!item) {
      return;
    }

    const list = item.closest('.suggestion-list');
    const input = list?.previousElementSibling;
    if (!input || !input.matches('[data-suggestion-field], [data-organization-field]')) {
      return;
    }

    input.value = item.dataset.value || '';
    if (input.matches('[data-organization-field]')) {
      hideSuggestionList(input);
      input.focus();
      return;
    }

    const matchedContact = contacts.find((contact) => {
      if (input.dataset.suggestionField === 'phoneNumber') {
        return normalizePhoneDigits(contact.phoneNumber) === normalizePhoneDigits(input.value);
      }
      return String(contact[input.dataset.suggestionField] || '').trim() === input.value;
    });

    if (matchedContact) {
      fillCallerFromContact(matchedContact, true);
    }
    hideSuggestionList(input);
    input.focus();
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
    updateResolvedSelectTone(event.target);
  });

  document.getElementById('isResolved').addEventListener('change', (event) => {
    updateResolvedSelectTone(event.target);
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
      closeModal(importModal);
      await loadRecords();
    } catch (error) {
      setStatus(importStatus, error.message, true);
    }
  });

  searchInput.addEventListener('input', () => {
    recordCurrentPage = 1;
    renderRecords();
  });
  statusFilter.addEventListener('change', () => {
    recordCurrentPage = 1;
    updateStatusFilterTone();
    renderRecords();
  });

  recordPageSize.addEventListener('change', () => {
    recordCurrentPage = 1;
    renderRecords();
  });

  recordPrevPage.addEventListener('click', () => {
    recordCurrentPage -= 1;
    renderRecords();
  });

  recordNextPage.addEventListener('click', () => {
    recordCurrentPage += 1;
    renderRecords();
  });

  selectAllRecords.addEventListener('change', () => {
    const visibleRecords = getRecordPage().items;
    if (selectAllRecords.checked) {
      visibleRecords.forEach((record) => selectedRecordIds.add(record.id));
    } else {
      visibleRecords.forEach((record) => selectedRecordIds.delete(record.id));
    }
    renderRecords();
  });

  exportCsvBtn.addEventListener('click', () => {
    const selectedRecords = getSelectedRecords();
    if (selectedRecords.length === 0) {
      alert('请先勾选要导出的记录，或点表头复选框全选当前列表。');
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

  document.querySelector('[data-modal-open]').addEventListener('click', () => {
    setDefaultCallTime();
    setStatus(formStatus, '');
    openModal(recordModal);
    document.getElementById('callerName').focus();
  });

  document.querySelector('[data-modal-close]').addEventListener('click', () => closeModal(recordModal));
  openOrganizationBtn.addEventListener('click', () => {
    setOrganizationStatus('');
    organizationForm.reset();
    openModal(organizationModal);
    organizationName.focus();
  });
  document.querySelector('[data-organization-close]').addEventListener('click', () => closeModal(organizationModal));
  openImportBtn.addEventListener('click', () => {
    setStatus(importStatus, '');
    openModal(importModal);
  });
  document.querySelector('[data-import-close]').addEventListener('click', () => closeModal(importModal));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    if (!recordModal.hidden) {
      closeModal(recordModal);
    }
    if (!organizationModal.hidden) {
      closeModal(organizationModal);
    }
    if (!importModal.hidden) {
      closeModal(importModal);
    }
  });

  organizationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setOrganizationStatus('正在保存...');
    try {
      await saveOrganization(null, organizationName.value);
      organizationForm.reset();
      setOrganizationStatus('已保存');
      organizationName.focus();
    } catch (error) {
      setOrganizationStatus(error.message, true);
    }
  });

  organizationList.addEventListener('click', async (event) => {
    const row = event.target.closest('.organization-row');
    if (!row) {
      return;
    }

    const id = row.dataset.id;
    const name = row.querySelector('input').value;

    if (event.target.classList.contains('js-save-organization')) {
      try {
        await saveOrganization(id, name);
        setOrganizationStatus('已保存');
      } catch (error) {
        setOrganizationStatus(error.message, true);
      }
      return;
    }

    if (event.target.classList.contains('js-delete-organization')) {
      const organization = organizations.find((item) => item.id === id);
      if (!confirm(`确定删除组织机构吗？\n${organization?.name || name}`)) {
        return;
      }
      try {
        await deleteOrganization(id);
        setOrganizationStatus('已删除');
      } catch (error) {
        setOrganizationStatus(error.message, true);
      }
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    setDefaultCallTime();
    updateStatusFilterTone();
    const recordSearch = getRecordSearchFromSearchParams(window.location.search);
    if (recordSearch) {
      searchInput.value = recordSearch;
    }

    const prefill = getRecordPrefillFromSearchParams(window.location.search);

    if (prefill.shouldOpen) {
      applyRecordPrefill(prefill);
      setStatus(formStatus, '');
      openModal(recordModal);
      document.getElementById(prefill.callerUnit ? 'phoneNumber' : 'callerName').focus();
    }

    Promise.all([loadContacts(), loadOrganizations(), loadRecords()]).catch((error) => {
      recordsBody.innerHTML = '';
      renderEmptyRow(error.message, true);
    });
  });
}
