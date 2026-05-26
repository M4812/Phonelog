let contacts = [];
let contactCurrentPage = 1;

function normalizeContactSearchText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeContactPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function filterContacts(sourceContacts, keyword = '') {
  const text = String(keyword || '').trim().toLowerCase();
  const compactText = normalizeContactSearchText(keyword);
  const phoneDigits = normalizeContactPhoneDigits(keyword);

  if (!text) {
    return sourceContacts;
  }

  return sourceContacts.filter((contact) => {
    const searchable = [
      contact.phoneNumber,
      contact.callerUnit,
      contact.callerName,
      contact.remark
    ].join(' ').toLowerCase();
    const compactSearchable = [
      contact.callerUnit,
      contact.callerName
    ].map(normalizeContactSearchText).join(' ');

    return searchable.includes(text) ||
      (compactText && compactSearchable.includes(compactText)) ||
      (phoneDigits && normalizeContactPhoneDigits(contact.phoneNumber).includes(phoneDigits));
  });
}

function getPagedItems(sourceItems, page = 1, pageSize = 50) {
  const safePageSize = Math.max(1, Number(pageSize) || 50);
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

function buildRecordSearchUrl(contact = {}) {
  const params = new URLSearchParams();
  const callerUnit = String(contact.callerUnit || '').trim();

  if (callerUnit) {
    params.set('search', callerUnit);
  }

  return `/?${params.toString()}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildRecordSearchUrl, filterContacts, getPagedItems, normalizeContactPhoneDigits };
}

if (typeof document !== 'undefined') {
  const contactSearch = document.getElementById('contactSearch');
  const contactsBody = document.getElementById('contactsBody');
  const contactCount = document.getElementById('contactCount');
  const contactPageSize = document.getElementById('contactPageSize');
  const contactPrevPage = document.getElementById('contactPrevPage');
  const contactNextPage = document.getElementById('contactNextPage');
  const contactPageInfo = document.getElementById('contactPageInfo');

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store',
      ...options
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if ((url.startsWith('/api/contacts') || url.startsWith('/api/contact-units')) && response.status === 404) {
        throw new Error('通讯录接口不可用，请重启当前 3000 服务后再刷新页面。');
      }
      throw new Error(data.message || '请求失败');
    }

    return data;
  }

  function createCell(text, className = '') {
    const cell = document.createElement('td');
    cell.textContent = text || '';
    if (className) {
      cell.className = className;
    }
    return cell;
  }

  function getVisibleContacts() {
    return filterContacts(contacts, contactSearch.value);
  }

  function renderContacts() {
    const visibleContacts = getVisibleContacts();
    const page = getPagedItems(visibleContacts, contactCurrentPage, contactPageSize.value);
    contactsBody.innerHTML = '';
    contactCount.textContent = `显示 ${visibleContacts.length} 条 / 共 ${contacts.length} 条`;
    contactCurrentPage = page.page;
    contactPageInfo.textContent = `第 ${page.page} / ${page.pageCount} 页`;
    contactPrevPage.disabled = page.page <= 1;
    contactNextPage.disabled = page.page >= page.pageCount;

    if (contacts.length === 0) {
      const row = document.createElement('tr');
      const cell = createCell('暂无通讯录记录', 'empty-cell');
      cell.colSpan = 6;
      row.appendChild(cell);
      contactsBody.appendChild(row);
      return;
    }

    if (visibleContacts.length === 0) {
      const row = document.createElement('tr');
      const cell = createCell('没有匹配的单位记录', 'empty-cell');
      cell.colSpan = 6;
      row.appendChild(cell);
      contactsBody.appendChild(row);
      return;
    }

    page.items.forEach((contact, index) => {
      const row = document.createElement('tr');
      row.dataset.id = contact.id;
      row.dataset.searchUrl = buildRecordSearchUrl(contact);

      const unitLink = document.createElement('a');
      unitLink.className = 'stat-register-link unit-register-link';
      unitLink.href = row.dataset.searchUrl;
      unitLink.textContent = contact.callerUnit || '-';
      unitLink.title = '查看该单位的历史来电记录';

      const countLink = document.createElement('a');
      countLink.className = 'stat-register-link count-register-link';
      countLink.href = row.dataset.searchUrl;
      countLink.textContent = String(contact.callCount || 0);
      countLink.title = '查看该单位的历史来电记录';

      row.append(
        createCell(String((page.page - 1) * page.pageSize + index + 1), 'muted-cell'),
        (() => {
          const cell = createCell('', 'question-cell');
          cell.appendChild(unitLink);
          return cell;
        })(),
        createCell(contact.phoneNumber || '-', 'muted-cell'),
        createCell(contact.callerName || '-', 'muted-cell'),
        (() => {
          const cell = createCell('');
          cell.appendChild(countLink);
          return cell;
        })(),
        createCell(contact.updatedAt || '-', 'muted-cell')
      );

      contactsBody.appendChild(row);
    });
  }

  async function loadContacts() {
    contactsBody.innerHTML = '<tr><td colspan="6" class="empty-cell">正在加载...</td></tr>';
    contacts = await fetchJson('/api/contact-units');
    renderContacts();
  }

  contactSearch.addEventListener('input', () => {
    contactCurrentPage = 1;
    renderContacts();
  });

  contactPageSize.addEventListener('change', () => {
    contactCurrentPage = 1;
    renderContacts();
  });

  contactPrevPage.addEventListener('click', () => {
    contactCurrentPage -= 1;
    renderContacts();
  });

  contactNextPage.addEventListener('click', () => {
    contactCurrentPage += 1;
    renderContacts();
  });

  document.addEventListener('DOMContentLoaded', () => {
    loadContacts().catch((error) => {
      contactsBody.innerHTML = '';
      const row = document.createElement('tr');
      const cell = createCell(error.message, 'empty-cell error-text');
      cell.colSpan = 6;
      row.appendChild(cell);
      contactsBody.appendChild(row);
    });
  });
}
