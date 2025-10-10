const charts = {};

const elements = {
  startDate: document.getElementById('start-date'),
  endDate: document.getElementById('end-date'),
  applyFilters: document.getElementById('apply-filters'),
  clearFilters: document.getElementById('clear-filters'),
  exportExcel: document.getElementById('export-excel'),
  statusBanner: document.getElementById('status-banner')
};

const dashboardState = {
  filters: {
    startDate: '',
    endDate: ''
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

function setStatus(message, tone = 'info') {
  if (!elements.statusBanner) {
    return;
  }

  const banner = elements.statusBanner;
  banner.classList.remove('info', 'error', 'success', 'hidden');

  if (!message) {
    banner.textContent = '';
    banner.classList.add('hidden');
    return;
  }

  banner.textContent = message;
  banner.classList.add(tone);
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
    tooltip: {
      trigger: 'axis'
    },
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

function renderMessagesPerAgent(data = []) {
  const labels = data.map((item) => item.agentLabel ?? 'Unassigned');
  const counts = data.map((item) => item.messages ?? 0);
  const averages = data.map((item) => item.averageMessagesPerConversation ?? 0);
  const conversationCounts = data.map((item) => item.conversations ?? 0);

  initChart('messages-agent-chart', {
    tooltip: {
      trigger: 'axis',
      formatter(params) {
        if (!Array.isArray(params) || !params.length) {
          return '';
        }
        const index = params[0].dataIndex;
        const agent = labels[index] || 'Unassigned';
        const messageCount = counts[index] ?? 0;
        const conversationCount = conversationCounts[index] ?? 0;
        const avg = averages[index] ?? 0;
        return `${agent}<br/>Messages: ${messageCount.toLocaleString()}<br/>Conversations: ${conversationCount.toLocaleString()}<br/>Avg per Conversation: ${avg}`;
      }
    },
    grid: { left: '6%', right: '4%', bottom: '8%', top: '6%', containLabel: true },
    xAxis: {
      type: 'value'
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#e2e8f0' }
    },
    series: [
      {
        name: 'Messages',
        type: 'bar',
        data: counts,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
            { offset: 0, color: '#34d399' },
            { offset: 1, color: '#059669' }
          ])
        }
      }
    ]
  });
}

function renderConversationsPerAgent(data = []) {
  const labels = data.map((item) => item.agentLabel ?? 'Unassigned');
  const counts = data.map((item) => item.conversations ?? 0);

  initChart('conversations-agent-chart', {
    tooltip: { trigger: 'axis' },
    grid: { left: '6%', right: '4%', bottom: '8%', top: '6%', containLabel: true },
    xAxis: { type: 'value' },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#e2e8f0' }
    },
    series: [
      {
        name: 'Conversations',
        type: 'bar',
        data: counts,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
            { offset: 0, color: '#c084fc' },
            { offset: 1, color: '#7c3aed' }
          ])
        }
      }
    ]
  });
}

function renderTimeSeriesChart(id, title, data = [], colors = {}) {
  const dates = data.map((item) => item.date);
  const counts = data.map((item) => item.count ?? 0);
  const lineColor = colors.line || '#6366f1';
  const areaStart = colors.areaStart || 'rgba(99, 102, 241, 0.45)';
  const areaEnd = colors.areaEnd || 'rgba(59, 130, 246, 0.1)';

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
            { offset: 0, color: areaStart },
            { offset: 1, color: areaEnd }
          ])
        },
        lineStyle: {
          width: 3,
          color: lineColor
        },
        itemStyle: { color: lineColor },
        data: counts
      }
    ]
  });
}

function renderMessagesByEndpoint(data = []) {
  const seriesData = data.map((item) => ({
    name: item.endpoint ?? 'Unknown',
    value: item.count ?? 0
  }));

  initChart('messages-endpoint-chart', {
    tooltip: {
      trigger: 'item',
      formatter: (params) => `${params.name}: ${params.value.toLocaleString()} (${params.percent}%)`
    },
    legend: {
      orient: 'horizontal',
      bottom: 0,
      textStyle: { color: '#cbd5f5' }
    },
    series: [
      {
        name: 'Messages',
        type: 'pie',
        radius: ['35%', '70%'],
        avoidLabelOverlap: true,
        padAngle: 2,
        itemStyle: {
          borderRadius: 12,
          borderColor: '#0f172a',
          borderWidth: 2
        },
        label: {
          formatter: '{b}: {d}%'
        },
        data: seriesData
      }
    ]
  });
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
    setStatus('Loading data…', 'info');
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
        // Ignore JSON parse errors and use default message
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

    renderTotals(data.totals);
    renderAgentsPerCategory(data.agentsPerCategory);
    renderMessagesPerUser(data.messagesPerUser);
    renderTimeSeriesChart('messages-day-chart', 'Messages', data.messagesPerDay);
    renderTimeSeriesChart('users-day-chart', 'Users Logged', data.usersLoggedPerDay, {
      line: '#22c55e',
      areaStart: 'rgba(34, 197, 94, 0.45)',
      areaEnd: 'rgba(34, 197, 94, 0.08)'
    });
    renderMessagesPerAgent(data.messagesPerAgent);
    renderConversationsPerAgent(data.conversationsPerAgent);
    renderTimeSeriesChart('active-users-day-chart', 'Active Users', data.activeUsersPerDay, {
      line: '#fb923c',
      areaStart: 'rgba(251, 146, 60, 0.45)',
      areaEnd: 'rgba(251, 146, 60, 0.08)'
    });
    renderTimeSeriesChart('new-users-day-chart', 'New Users', data.newUsersPerDay, {
      line: '#a855f7',
      areaStart: 'rgba(168, 85, 247, 0.45)',
      areaEnd: 'rgba(168, 85, 247, 0.08)'
    });
    renderMessagesByEndpoint(data.messagesByEndpoint);

    setStatus('Dashboard refreshed successfully.', 'success');
  } catch (error) {
    console.error('Failed to load dashboard', error);
    setStatus(`Failed to load data. ${error.message}`, 'error');
  }
}

function handleApplyFilters() {
  const start = elements.startDate?.value || '';
  const end = elements.endDate?.value || '';

  if (!validateDateRange(start, end)) {
    setStatus('Invalid date range. Start date must be before end date.', 'error');
    return;
  }

  dashboardState.filters.startDate = start;
  dashboardState.filters.endDate = end;
  loadDashboard();
}

function handleClearFilters() {
  dashboardState.filters.startDate = '';
  dashboardState.filters.endDate = '';
  syncFilterInputs();
  loadDashboard();
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
  XLSX.utils.book_append_sheet(workbook, usersPerDaySheet, 'Users Logged per Day');

  const conversationsPerAgentSheet = XLSX.utils.json_to_sheet(
    (dashboardState.raw.conversationsPerAgent ?? []).map((item) => ({
      agentId: item.agentId || '',
      agentLabel: item.agentLabel || 'Unassigned',
      conversations: item.conversations ?? 0
    }))
  );
  XLSX.utils.book_append_sheet(workbook, conversationsPerAgentSheet, 'Conversations per Agent');

  const messagesPerAgentSheet = XLSX.utils.json_to_sheet(
    (dashboardState.raw.messagesPerAgent ?? []).map((item) => ({
      agentId: item.agentId || '',
      agentLabel: item.agentLabel || 'Unassigned',
      messages: item.messages ?? 0,
      conversations: item.conversations ?? 0,
      averageMessagesPerConversation: item.averageMessagesPerConversation ?? 0
    }))
  );
  XLSX.utils.book_append_sheet(workbook, messagesPerAgentSheet, 'Messages per Agent');

  const endpointSheet = XLSX.utils.json_to_sheet(dashboardState.raw.messagesByEndpoint ?? []);
  XLSX.utils.book_append_sheet(workbook, endpointSheet, 'Messages by Endpoint');

  const activeUsersSheet = XLSX.utils.json_to_sheet(dashboardState.raw.activeUsersPerDay ?? []);
  XLSX.utils.book_append_sheet(workbook, activeUsersSheet, 'Active Users per Day');

  const newUsersSheet = XLSX.utils.json_to_sheet(dashboardState.raw.newUsersPerDay ?? []);
  XLSX.utils.book_append_sheet(workbook, newUsersSheet, 'New Users per Day');

  const dateSuffix = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `librechat-dashboard-${dateSuffix}.xlsx`);
}

window.addEventListener('load', () => {
  syncFilterInputs();
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

  window.addEventListener('resize', () => {
    Object.values(charts).forEach((chart) => chart.resize());
  });
});
