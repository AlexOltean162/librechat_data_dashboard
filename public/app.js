const charts = {};
const MESSAGE_PAGE_SIZE = 10;

const elements = {
  tableBody: document.getElementById('messages-table-body'),
  tableMeta: document.getElementById('table-meta'),
  startDate: document.getElementById('start-date'),
  endDate: document.getElementById('end-date'),
  applyFilters: document.getElementById('apply-filters'),
  clearFilters: document.getElementById('clear-filters'),
  exportExcel: document.getElementById('export-excel'),
  prevPage: document.getElementById('prev-page'),
  nextPage: document.getElementById('next-page'),
  pageIndicator: document.getElementById('page-indicator')
};

const dashboardState = {
  filters: {
    startDate: '',
    endDate: ''
  },
  table: {
    records: [],
    totalMatching: 0,
    limit: 50,
    page: 1,
    pageSize: MESSAGE_PAGE_SIZE
  },
  raw: null
};

function initChart(id, options) {
  const container = document.getElementById(id);
  if (!container) {
    return null;
  }

  let chart = charts[id];
  if (!chart) {
    chart = echarts.init(container, null, { renderer: 'svg' });
    charts[id] = chart;
  }
  chart.setOption(options, true);
  return chart;
}

function formatNumber(value) {
  if (value == null) return '-';
  return value.toLocaleString();
}

function formatTimestamp(value) {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return date.toLocaleString();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function normalizeMessageText(value) {
  if (value == null) {
    return 'No text';
  }

  if (typeof value === 'string') {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    return trimmed ? escapeHtml(trimmed) : 'No text';
  }

  try {
    const serialised = JSON.stringify(value);
    return serialised ? escapeHtml(serialised) : 'No text';
  } catch (error) {
    return escapeHtml(String(value));
  }
}

function renderTotals(totals = {}) {
  document.getElementById('total-agents').textContent = formatNumber(totals.agents);
  document.getElementById('total-users').textContent = formatNumber(totals.users);
  document.getElementById('total-messages').textContent = formatNumber(totals.messages);
}

function renderAgentsPerCategory(data = []) {
  const categories = data.map((item) => item.category ?? 'Uncategorized');
  const counts = data.map((item) => item.count ?? 0);

  initChart('agents-category-chart', {
    tooltip: { trigger: 'axis' },
    grid: { left: '6%', right: '4%', bottom: '8%', top: '6%', containLabel: true },
    xAxis: {
      type: 'value',
      boundaryGap: [0, 0.01]
    },
    yAxis: {
      type: 'category',
      data: categories,
      axisLabel: { color: '#e2e8f0' }
    },
    series: [
      {
        name: 'Agents',
        type: 'bar',
        data: counts,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
            { offset: 0, color: '#60a5fa' },
            { offset: 1, color: '#0ea5e9' }
          ])
        }
      }
    ]
  });
}

function renderMessagesPerUser(data = []) {
  const labels = data.map((item) => item.userLabel ?? 'Unknown');
  const counts = data.map((item) => item.count ?? 0);

  initChart('messages-user-chart', {
    tooltip: { trigger: 'axis' },
    grid: { left: '5%', right: '4%', bottom: 80, top: '6%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        interval: 0,
        rotate: 15,
        color: '#e2e8f0',
        formatter(value) {
          if (typeof value !== 'string') {
            return value;
          }
          const parts = value.split(' ');
          if (parts.length > 2) {
            return `${parts.slice(0, 2).join(' ')}\n${parts.slice(2).join(' ')}`;
          }
          if (parts.length === 2) {
            return `${parts[0]}\n${parts[1]}`;
          }
          return value;
        }
      }
    },
    yAxis: {
      type: 'value'
    },
    series: [
      {
        name: 'Messages',
        type: 'bar',
        data: counts,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#f97316' },
            { offset: 1, color: '#ef4444' }
          ])
        }
      }
    ]
  });
}

function renderTimeSeriesChart(id, title, data = []) {
  const dates = data.map((item) => item.date);
  const counts = data.map((item) => item.count ?? 0);

  initChart(id, {
    tooltip: { trigger: 'axis' },
    grid: { left: '5%', right: '4%', bottom: 40, top: '8%', containLabel: true },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: '#e2e8f0' }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#e2e8f0' }
    },
    series: [
      {
        name: title,
        type: 'line',
        smooth: true,
        symbolSize: 8,
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(99, 102, 241, 0.45)' },
            { offset: 1, color: 'rgba(59, 130, 246, 0.1)' }
          ])
        },
        lineStyle: {
          width: 3
        },
        data: counts
      }
    ]
  });
}

function updatePaginationControls(totalPages) {
  if (!elements.prevPage || !elements.nextPage || !elements.pageIndicator) {
    return;
  }

  if (!dashboardState.table.records.length) {
    elements.prevPage.disabled = true;
    elements.nextPage.disabled = true;
    elements.pageIndicator.textContent = 'Page 0 of 0';
    return;
  }

  elements.prevPage.disabled = dashboardState.table.page <= 1;
  elements.nextPage.disabled = dashboardState.table.page >= totalPages;
  elements.pageIndicator.textContent = `Page ${dashboardState.table.page} of ${totalPages}`;
}

function renderMessagesTable() {
  if (!elements.tableBody || !elements.tableMeta) {
    return;
  }

  const { records, page, pageSize, totalMatching } = dashboardState.table;

  if (!records.length) {
    elements.tableBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty">No messages found.</td>
      </tr>
    `;
    elements.tableMeta.textContent = '0 messages';
    updatePaginationControls(0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  if (page > totalPages) {
    dashboardState.table.page = totalPages;
  }

  const startIndex = (dashboardState.table.page - 1) * pageSize;
  const pageRecords = records.slice(startIndex, startIndex + pageSize);

  elements.tableBody.innerHTML = pageRecords
    .map((message) => {
      const timestamp = escapeHtml(formatTimestamp(message.createdAt));
      const userDisplay = escapeHtml((message.userName || message.userId || 'Unknown').toString());
      const conversation = message.conversationId ? escapeHtml(message.conversationId.toString()) : '—';
      const sender = escapeHtml((message.sender ?? 'Unknown').toString());
      const textContent = normalizeMessageText(message.text);

      return `
        <tr>
          <td>${timestamp}</td>
          <td>${userDisplay}</td>
          <td>${sender}</td>
          <td>${conversation}</td>
          <td>${textContent}</td>
        </tr>
      `;
    })
    .join('');

  const startDisplay = startIndex + 1;
  const endDisplay = startIndex + pageRecords.length;
  const limitedTotal = records.length;
  const parts = [`Showing ${startDisplay}-${endDisplay} of ${limitedTotal} messages`];
  if (totalMatching > limitedTotal) {
    parts.push(`(displaying first ${limitedTotal} of ${totalMatching} messages)`);
  } else if (dashboardState.table.limit && limitedTotal === dashboardState.table.limit) {
    parts.push(`(displaying first ${limitedTotal} messages)`);
  }
  elements.tableMeta.textContent = parts.join(' ');

  updatePaginationControls(totalPages);
}

function displayTableMessage(message) {
  if (!elements.tableBody || !elements.tableMeta) {
    return;
  }

  dashboardState.table.records = [];
  dashboardState.table.totalMatching = 0;
  dashboardState.table.page = 1;

  const safeMessage = escapeHtml(message);
  elements.tableBody.innerHTML = `
    <tr>
      <td colspan="5" class="empty">${safeMessage}</td>
    </tr>
  `;
  elements.tableMeta.textContent = message;
  updatePaginationControls(0);
}

function syncFilterInputs() {
  if (elements.startDate) {
    elements.startDate.value = dashboardState.filters.startDate || '';
  }
  if (elements.endDate) {
    elements.endDate.value = dashboardState.filters.endDate || '';
  }
}

function validateDateRange(start, end) {
  if (start && end && start > end) {
    return false;
  }
  return true;
}

async function loadDashboard() {
  try {
    const params = new URLSearchParams();
    if (dashboardState.filters.startDate) {
      params.append('startDate', dashboardState.filters.startDate);
    }
    if (dashboardState.filters.endDate) {
      params.append('endDate', dashboardState.filters.endDate);
    }

    const query = params.toString();
    const response = await fetch(query ? `/api/dashboard?${query}` : '/api/dashboard');

    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`;
      try {
        const payload = await response.json();
        errorMessage = payload?.message || payload?.error || errorMessage;
      } catch (parseError) {
        // ignore JSON parse errors and use default message
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    dashboardState.raw = data;

    if (data.filters) {
      dashboardState.filters.startDate = data.filters.startDate ? data.filters.startDate.slice(0, 10) : '';
      dashboardState.filters.endDate = data.filters.endDate ? data.filters.endDate.slice(0, 10) : '';
      syncFilterInputs();
    }

    dashboardState.table.records = Array.isArray(data.messagesTable?.records) ? data.messagesTable.records : [];
    dashboardState.table.totalMatching = Number(data.messagesTable?.totalMatching) || dashboardState.table.records.length;
    dashboardState.table.limit = Number(data.messagesTable?.limit) || dashboardState.table.records.length;
    dashboardState.table.page = 1;

    renderTotals(data.totals);
    renderAgentsPerCategory(data.agentsPerCategory);
    renderMessagesPerUser(data.messagesPerUser);
    renderTimeSeriesChart('messages-day-chart', 'Messages', data.messagesPerDay);
    renderTimeSeriesChart('users-day-chart', 'Users Logged', data.usersLoggedPerDay);
    renderMessagesTable();
  } catch (error) {
    console.error('Failed to load dashboard', error);
    displayTableMessage(`Failed to load data. ${error.message}`);
  }
}

function handleApplyFilters() {
  const start = elements.startDate?.value || '';
  const end = elements.endDate?.value || '';

  if (!validateDateRange(start, end)) {
    displayTableMessage('Invalid date range. Start date must be before end date.');
    return;
  }

  dashboardState.filters.startDate = start;
  dashboardState.filters.endDate = end;
  dashboardState.table.page = 1;
  displayTableMessage('Loading data…');
  loadDashboard();
}

function handleClearFilters() {
  dashboardState.filters.startDate = '';
  dashboardState.filters.endDate = '';
  dashboardState.table.page = 1;
  syncFilterInputs();
  displayTableMessage('Loading data…');
  loadDashboard();
}

function handlePagination(delta) {
  const { records, pageSize } = dashboardState.table;
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const nextPage = dashboardState.table.page + delta;
  if (nextPage < 1 || nextPage > totalPages) {
    return;
  }
  dashboardState.table.page = nextPage;
  renderMessagesTable();
}

function exportDashboardToExcel() {
  if (typeof XLSX === 'undefined') {
    console.warn('Excel export is unavailable because XLSX is not loaded.');
    return;
  }

  if (!dashboardState.raw) {
    console.warn('No dashboard data to export yet.');
    return;
  }

  const workbook = XLSX.utils.book_new();

  const totalsSheet = XLSX.utils.aoa_to_sheet([
    ['Metric', 'Value'],
    ['Total Agents', dashboardState.raw.totals?.agents ?? 0],
    ['Total Users', dashboardState.raw.totals?.users ?? 0],
    ['Total Messages', dashboardState.raw.totals?.messages ?? 0]
  ]);
  XLSX.utils.book_append_sheet(workbook, totalsSheet, 'Totals');

  const agentsSheet = XLSX.utils.json_to_sheet(dashboardState.raw.agentsPerCategory ?? []);
  XLSX.utils.book_append_sheet(workbook, agentsSheet, 'Agents per Category');

  const messagesPerUserSheet = XLSX.utils.json_to_sheet(dashboardState.raw.messagesPerUser ?? []);
  XLSX.utils.book_append_sheet(workbook, messagesPerUserSheet, 'Messages per User');

  const messagesPerDaySheet = XLSX.utils.json_to_sheet(dashboardState.raw.messagesPerDay ?? []);
  XLSX.utils.book_append_sheet(workbook, messagesPerDaySheet, 'Messages per Day');

  const usersPerDaySheet = XLSX.utils.json_to_sheet(dashboardState.raw.usersLoggedPerDay ?? []);
  XLSX.utils.book_append_sheet(workbook, usersPerDaySheet, 'Users per Day');

  const messageRecords = (dashboardState.raw.messagesTable?.records ?? []).map((record) => ({
    Timestamp: formatTimestamp(record.createdAt),
    User: record.userName || record.userId || 'Unknown',
    UserId: record.userId || '',
    Sender: record.sender || '',
    ConversationId: record.conversationId || '',
    MessageId: record.messageId || '',
    Text: typeof record.text === 'string' ? record.text : JSON.stringify(record.text ?? '')
  }));
  const messagesSheet = XLSX.utils.json_to_sheet(messageRecords);
  XLSX.utils.book_append_sheet(workbook, messagesSheet, 'Recent Messages');

  const dateSuffix = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `librechat-dashboard-${dateSuffix}.xlsx`);
}

window.addEventListener('load', () => {
  syncFilterInputs();
  displayTableMessage('Loading data…');
  loadDashboard();

  if (elements.applyFilters) {
    elements.applyFilters.addEventListener('click', handleApplyFilters);
  }

  if (elements.clearFilters) {
    elements.clearFilters.addEventListener('click', handleClearFilters);
  }

  if (elements.exportExcel) {
    elements.exportExcel.addEventListener('click', exportDashboardToExcel);
  }

  if (elements.prevPage) {
    elements.prevPage.addEventListener('click', () => handlePagination(-1));
  }

  if (elements.nextPage) {
    elements.nextPage.addEventListener('click', () => handlePagination(1));
  }

  window.addEventListener('resize', () => {
    Object.values(charts).forEach((chart) => chart.resize());
  });
});
