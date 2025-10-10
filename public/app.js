const charts = {};

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
    grid: { left: '3%', right: '4%', bottom: '5%', containLabel: true },
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
    grid: { left: '3%', right: '4%', bottom: '5%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        rotate: 30,
        interval: 0,
        color: '#e2e8f0'
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

function renderMessagesTable(messages = []) {
  const body = document.getElementById('messages-table-body');
  const tableMeta = document.getElementById('table-meta');

  if (!messages.length) {
    body.innerHTML = `
      <tr>
        <td colspan="5" class="empty">No messages found.</td>
      </tr>
    `;
    tableMeta.textContent = '0 messages';
    return;
  }

  tableMeta.textContent = `${messages.length} messages`;
  body.innerHTML = messages
    .map((message) => {
      const timestamp = message.createdAt ? new Date(message.createdAt).toLocaleString() : 'N/A';
      const textContent = (message.text ?? '')
        .toString()
        .replace(/\s+/g, ' ')
        .trim();

      return `
        <tr>
          <td>${timestamp}</td>
          <td>${message.user ?? 'Unknown'}</td>
          <td>${message.sender ?? 'Unknown'}</td>
          <td>${message.conversationId ?? '—'}</td>
          <td>${textContent || '<em>No text</em>'}</td>
        </tr>
      `;
    })
    .join('');
}

async function loadDashboard() {
  try {
    const response = await fetch('/api/dashboard');
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    renderTotals(data.totals);
    renderAgentsPerCategory(data.agentsPerCategory);
    renderMessagesPerUser(data.messagesPerUser);
    renderTimeSeriesChart('messages-day-chart', 'Messages', data.messagesPerDay);
    renderTimeSeriesChart('users-day-chart', 'Users Logged', data.usersLoggedPerDay);
    renderMessagesTable(data.messagesTable);
  } catch (error) {
    console.error('Failed to load dashboard', error);
    const body = document.getElementById('messages-table-body');
    body.innerHTML = `
      <tr>
        <td colspan="5" class="empty">Failed to load data. Check the server logs.</td>
      </tr>
    `;
  }
}

window.addEventListener('load', () => {
  loadDashboard();
  window.addEventListener('resize', () => {
    Object.values(charts).forEach((chart) => chart.resize());
  });
});
