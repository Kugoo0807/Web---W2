// API Configuration
const ENDPOINTS = {
  user: 'http://localhost:4001',
  order: 'http://localhost:4002',
  product: 'http://localhost:4003',
  bff: 'http://localhost:4004',
  graphql: 'http://localhost:4005'
};

// State
const state = {
  dataset: 'small', // 'small' (u1 - 5 orders) or 'large' (u2 - 50 orders)
  client: 'web',    // 'web' or 'mobile'
  variant: 'baseline', // 'baseline', 'bff', 'graphql-n1', 'graphql-dl'
  chaos: 'none',    // 'none', 'slow', 'fault'
  lastResult: null,
  isBenchmarking: false
};

// DOM Elements
const datasetControl = document.getElementById('datasetControl');
const clientControl = document.getElementById('clientControl');
const variantControl = document.getElementById('variantControl');
const chaosSelect = document.getElementById('chaosSelect');
const btnRunOnce = document.getElementById('btnRunOnce');
const btnRunBenchmark = document.getElementById('btnRunBenchmark');

const valDuration = document.getElementById('valDuration');
const valClientReqs = document.getElementById('valClientReqs');
const valServiceCalls = document.getElementById('valServiceCalls');
const valDbQueries = document.getElementById('valDbQueries');
const valPayloadSize = document.getElementById('valPayloadSize');

const waterfallChart = document.getElementById('waterfallChart');
const waterfallSummary = document.getElementById('waterfallSummary');
const benchmarkTableBody = document.getElementById('benchmarkTableBody');
const benchmarkStatus = document.getElementById('benchmarkStatus');

const errorBanner = document.getElementById('errorBanner');
const errorMessage = document.getElementById('errorMessage');

const webDashboardView = document.getElementById('webDashboardView');
const mobileAppContent = document.getElementById('mobileAppContent');
const traceLog = document.getElementById('traceLog');

// Event Listeners
datasetControl.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  datasetControl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.dataset = btn.dataset.dataset;
});

clientControl.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  clientControl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.client = btn.dataset.client;
});

variantControl.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  variantControl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.variant = btn.dataset.variant;
});

chaosSelect.addEventListener('change', (e) => {
  state.chaos = e.target.value;
});

btnRunOnce.addEventListener('click', async () => {
  if (state.isBenchmarking) return;
  btnRunOnce.disabled = true;
  btnRunOnce.innerHTML = 'Đang chạy...';
  try {
    const screenStart = performance.now();
    const result = await executeRun(state.variant, state.dataset, state.client, state.chaos);
    renderMetrics(result);
    renderWaterfall(result);
    renderViews(result);
    renderTrace(result);
    // Mốc hoàn tất màn hình: sau khi trình duyệt đã có một frame để paint dữ liệu vừa render.
    await new Promise(resolve => requestAnimationFrame(resolve));
    result.durationMs = Math.round(performance.now() - screenStart);
    renderMetrics(result);
    renderWaterfall(result);
  } catch (err) {
    console.error('Run failed:', err);
    alert('Thực thi thất bại: ' + err.message);
  } finally {
    btnRunOnce.disabled = false;
    btnRunOnce.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Chạy 1 lần`;
  }
});

btnRunBenchmark.addEventListener('click', async () => {
  if (state.isBenchmarking) return;
  state.isBenchmarking = true;
  btnRunBenchmark.disabled = true;
  btnRunOnce.disabled = true;
  benchmarkStatus.textContent = 'Đang chạy 5 lần benchmark cho từng biến thể...';

  try {
    await runFullBenchmark();
  } catch (err) {
    console.error('Benchmark failed:', err);
  } finally {
    state.isBenchmarking = false;
    btnRunBenchmark.disabled = false;
    btnRunOnce.disabled = false;
    benchmarkStatus.textContent = 'Hoàn tất đo đạc';
  }
});

// Helper lấy Chaos params
function getChaosHeadersAndQuery() {
  let delay = 0;
  let fault = 0;
  if (state.chaos === 'slow') delay = 2000;
  if (state.chaos === 'fault') fault = 500;

  const headers = {};
  if (delay > 0) headers['x-chaos-delay'] = String(delay);
  if (fault > 0) headers['x-chaos-fault'] = String(fault);

  const query = delay > 0 ? `&delay=${delay}` : (fault > 0 ? `&fault=${fault}` : '');
  return { headers, query };
}

// ----------------------------------------------------------------------------------
// CORE EXECUTION ENGINES FOR 4 VARIANTS
// ----------------------------------------------------------------------------------

// 1. BASELINE EXECUTION (Client-side Composition)
async function executeBaseline(userId, clientTarget, chaos) {
  const t0 = performance.now();
  const timeline = [];
  let clientRequests = 0;
  let internalCalls = 0;
  let dbQueries = 0;
  let payloadBytes = 0;
  const errors = [];
  const { headers: chaosHeaders, query: chaosQuery } = getChaosHeadersAndQuery();

  // Step 1: Fetch User (chỉ cần nếu web client)
  let user = null;
  if (clientTarget === 'web') {
    const userStart = performance.now() - t0;
    clientRequests++;
    const uRes = await fetch(`${ENDPOINTS.user}/users/${userId}`);
    const uBytes = parseInt(uRes.headers.get('content-length') || '0', 10);
    const uQueries = parseInt(uRes.headers.get('x-db-queries') || '1', 10);
    dbQueries += uQueries;
    user = await uRes.json();
    payloadBytes += uBytes || JSON.stringify(user).length;
    timeline.push({
      label: `Client ➔ User Service (/users/${userId})`,
      service: 'user',
      startMs: Math.round(userStart),
      durationMs: Math.round(performance.now() - t0 - userStart)
    });
  }

  // Step 2: Fetch Orders
  const orderStart = performance.now() - t0;
  clientRequests++;
  const oRes = await fetch(`${ENDPOINTS.order}/orders?userId=${userId}`);
  const oBytes = parseInt(oRes.headers.get('content-length') || '0', 10);
  const oQueries = parseInt(oRes.headers.get('x-db-queries') || '2', 10);
  dbQueries += oQueries;
  const orders = await oRes.json();
  payloadBytes += oBytes || JSON.stringify(orders).length;
  timeline.push({
    label: `Client ➔ Order Service (/orders?userId=${userId})`,
    service: 'order',
    startMs: Math.round(orderStart),
    durationMs: Math.round(performance.now() - t0 - orderStart)
  });

  // Step 3: Fetch Products from Client (N+1 HTTP calls from browser)
  const productMap = new Map();
  const allItems = orders.flatMap(o => o.items || []);

  for (let idx = 0; idx < allItems.length; idx++) {
    const item = allItems[idx];
    const prodStart = performance.now() - t0;
    clientRequests++;

    try {
      const pRes = await fetch(`${ENDPOINTS.product}/products/${item.productId}?_r=${idx}${chaosQuery}`, {
        headers: chaosHeaders
      });
      const pQueries = parseInt(pRes.headers.get('x-db-queries') || '1', 10);
      dbQueries += pQueries;

      if (!pRes.ok) {
        throw new Error(`Product Service HTTP ${pRes.status}`);
      }
      const prod = await pRes.json();
      payloadBytes += JSON.stringify(prod).length;
      productMap.set(item.productId, prod);

      timeline.push({
        label: `Client ➔ Product Service (/products/${item.productId}) [#${idx + 1}]`,
        service: 'product',
        startMs: Math.round(prodStart),
        durationMs: Math.round(performance.now() - t0 - prodStart)
      });
    } catch (err) {
      errors.push({
        service: 'product-service',
        productId: item.productId,
        message: err.message
      });
      timeline.push({
        label: `Client ➔ Product Service (/products/${item.productId}) [ERROR]`,
        service: 'error',
        startMs: Math.round(prodStart),
        durationMs: Math.round(performance.now() - t0 - prodStart)
      });
    }
  }

  // Step 4: Client-side stitching
  let resultOrders = [];
  if (clientTarget === 'web') {
    resultOrders = orders.map(o => ({
      ...o,
      items: (o.items || []).map(it => ({
        ...it,
        product: productMap.get(it.productId) || null
      }))
    }));
  } else {
    // Mobile client
    for (const o of orders) {
      for (const it of (o.items || [])) {
        const p = productMap.get(it.productId);
        resultOrders.push({
          orderId: o.id,
          status: o.status,
          productName: p ? p.name : null,
          thumbnailUrl: p ? p.thumbnailUrl : null
        });
      }
    }
  }

  const durationMs = Math.round(performance.now() - t0);

  return {
    variant: 'Baseline (Client Composition)',
    clientTarget,
    durationMs,
    clientRequests,
    internalCalls: 0, // Baseline calls are all from client, no server-to-server calls
    dbQueries,
    payloadBytes,
    errors,
    timeline,
    data: { user, orders: resultOrders },
    trace: {
      summary: `Baseline gọi tuần tự ${clientRequests} request từ trình duyệt. Ghép dữ liệu diễn ra hoàn toàn tại client.`,
      calls: timeline.map(t => `${t.label} (${t.durationMs}ms)`)
    }
  };
}

// 2. BFF EXECUTION
async function executeBff(userId, clientTarget, chaos) {
  const t0 = performance.now();
  const { headers: chaosHeaders, query: chaosQuery } = getChaosHeadersAndQuery();

  const url = clientTarget === 'web'
    ? `${ENDPOINTS.bff}/api/web/dashboard?userId=${userId}${chaosQuery}`
    : `${ENDPOINTS.bff}/api/mobile/orders?userId=${userId}${chaosQuery}`;

  const res = await fetch(url, { headers: chaosHeaders });
  const rawText = await res.text();
  const payloadBytes = new Blob([rawText]).size;
  const json = JSON.parse(rawText);

  const durationMs = Math.round(performance.now() - t0);
  const metrics = json._metrics || { serviceCalls: 0, dbQueries: 0, serviceCallBreakdown: [] };

  const timeline = [
    {
      label: `Client ➔ BFF (${clientTarget === 'web' ? '/api/web/dashboard' : '/api/mobile/orders'})`,
      service: 'bff',
      startMs: 0,
      durationMs
    }
  ];

  if (metrics.serviceCallBreakdown) {
    for (const sc of metrics.serviceCallBreakdown) {
      timeline.push({
        label: `   └─ BFF ➔ ${sc.service} (${sc.url.split('/').pop()})`,
        service: sc.status >= 400 ? 'error' : (sc.service.includes('user') ? 'user' : (sc.service.includes('order') ? 'order' : 'product')),
        startMs: sc.startMs ?? 0,
        durationMs: sc.durationMs
      });
    }
  }

  return {
    variant: 'BFF (Backend For Frontend)',
    clientTarget,
    durationMs,
    clientRequests: 1,
    internalCalls: metrics.serviceCalls,
    dbQueries: metrics.dbQueries,
    payloadBytes,
    errors: json.errors || [],
    timeline,
    data: {
      user: json.user || null,
      orders: json.orders || []
    },
    trace: {
      summary: `BFF phục vụ đúng 1 request cho client. Server deduplicate các productId và gọi batch sang Product Service.`,
      calls: (metrics.serviceCallBreakdown || []).map(b => `${b.service} - ${b.status} (${b.durationMs}ms)`)
    }
  };
}

// 3. GRAPHQL EXECUTION (N+1 or DataLoader)
async function executeGraphql(userId, clientTarget, mode, chaos) {
  const t0 = performance.now();
  const { headers: chaosHeaders, query: chaosQuery } = getChaosHeadersAndQuery();

  // Queries
  const webQuery = `
    query WebDashboard($userId: ID!) {
      user(id: $userId) {
        id
        name
        email
        phone
        address
        avatar
      }
      orders(userId: $userId) {
        id
        orderDate
        status
        shippingAddress
        paymentMethod
        totalAmount
        items {
          id
          quantity
          unitPrice
          product {
            id
            name
            price
            description
            category
            thumbnailUrl
            inStock
          }
        }
      }
    }
  `;

  const mobileQuery = `
    query MobileOrders($userId: ID!) {
      orders(userId: $userId) {
        id
        status
        items {
          product {
            name
            thumbnailUrl
          }
        }
      }
    }
  `;

  const query = clientTarget === 'web' ? webQuery : mobileQuery;

  // GraphQL URL chưa có query string nên chaos params phải bắt đầu bằng '?'.
  const graphqlChaosQuery = chaosQuery ? `?${chaosQuery.slice(1)}` : '';
  const res = await fetch(`${ENDPOINTS.graphql}/graphql${graphqlChaosQuery}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-graphql-mode': mode,
      ...chaosHeaders
    },
    body: JSON.stringify({
      query,
      variables: { userId }
    })
  });

  const rawText = await res.text();
  const payloadBytes = new Blob([rawText]).size;
  const json = JSON.parse(rawText);

  const durationMs = Math.round(performance.now() - t0);
  const metrics = (json.extensions && json.extensions.metrics) || { serviceCalls: 0, dbQueries: 0, serviceCallBreakdown: [] };

  const timeline = [
    {
      label: `Client ➔ GraphQL (/graphql) [${mode === 'n1' ? 'N+1 Problem' : 'DataLoader Batch'}]`,
      service: 'graphql',
      startMs: 0,
      durationMs
    }
  ];

  if (metrics.serviceCallBreakdown) {
    for (const sc of metrics.serviceCallBreakdown) {
      timeline.push({
        label: `   └─ GraphQL ➔ ${sc.service} (${sc.url.split('/').pop()})`,
        service: sc.status >= 400 ? 'error' : (sc.service.includes('user') ? 'user' : (sc.service.includes('order') ? 'order' : 'product')),
        startMs: sc.startMs ?? 0,
        durationMs: sc.durationMs
      });
    }
  }

  // Format data for view
  let viewOrders = [];
  if (json.data && json.data.orders) {
    if (clientTarget === 'web') {
      viewOrders = json.data.orders;
    } else {
      // Mobile format
      for (const o of json.data.orders) {
        for (const it of (o.items || [])) {
          viewOrders.push({
            orderId: o.id,
            status: o.status,
            productName: it.product ? it.product.name : null,
            thumbnailUrl: it.product ? it.product.thumbnailUrl : null
          });
        }
      }
    }
  }

  const isN1 = mode === 'n1';
  return {
    variant: isN1 ? 'GraphQL (N+1 Unbatched)' : 'GraphQL (DataLoader Batched)',
    clientTarget,
    durationMs,
    clientRequests: 1,
    internalCalls: metrics.serviceCalls,
    dbQueries: metrics.dbQueries,
    payloadBytes,
    errors: json.errors || [],
    timeline,
    data: {
      user: json.data?.user || null,
      orders: viewOrders
    },
    trace: {
      summary: isN1
        ? `TÁI HIỆN N+1: GraphQL gọi ${metrics.serviceCalls} service calls nội bộ vì mỗi item tự gọi riêng lẻ tới Product Service!`
        : `SỬA N+1 BẰNG DATALOADER: Gom các ID trong 1 tick và loại bỏ trùng lặp, chỉ còn đúng ${metrics.serviceCalls} service calls!`,
      calls: (metrics.serviceCallBreakdown || []).map(b => `${b.service} [${b.status}]: ${b.url}`)
    }
  };
}

// Unified Execute
async function executeRun(variant, dataset, clientTarget, chaos) {
  const userId = dataset === 'small' ? 'u1' : 'u2';

  if (variant === 'baseline') {
    return await executeBaseline(userId, clientTarget, chaos);
  } else if (variant === 'bff') {
    return await executeBff(userId, clientTarget, chaos);
  } else if (variant === 'graphql-n1') {
    return await executeGraphql(userId, clientTarget, 'n1', chaos);
  } else if (variant === 'graphql-dl') {
    return await executeGraphql(userId, clientTarget, 'dataloader', chaos);
  }
}

// ----------------------------------------------------------------------------------
// RENDERING FUNCTIONS
// ----------------------------------------------------------------------------------

function renderMetrics(res) {
  valDuration.textContent = `${res.durationMs} ms`;
  valClientReqs.textContent = res.clientRequests;
  valServiceCalls.textContent = res.internalCalls;
  valDbQueries.textContent = res.dbQueries;
  valPayloadSize.textContent = `${(res.payloadBytes / 1024).toFixed(1)} KB (${res.payloadBytes} B)`;

  // Error Banner
  if (res.errors && res.errors.length > 0) {
    errorBanner.style.display = 'flex';
    errorMessage.textContent = `Chính sách Partial Failure đang hoạt động: ${res.errors.length} lỗi/cảnh báo được ghi nhận từ Product Service. Các trường sản phẩm bị lỗi trả về null, thông tin User và Orders vẫn được bảo toàn.`;
  } else {
    errorBanner.style.display = 'none';
  }
}

function renderWaterfall(res) {
  waterfallChart.innerHTML = '';
  const totalTime = Math.max(res.durationMs, 10);
  waterfallSummary.textContent = `${res.timeline.length} chặng • Mốc hoàn tất màn hình: ${res.durationMs}ms`;

  for (const item of res.timeline) {
    const row = document.createElement('div');
    row.className = 'waterfall-row';

    const label = document.createElement('div');
    label.className = 'waterfall-label';
    label.title = item.label;
    label.textContent = item.label;

    const track = document.createElement('div');
    track.className = 'waterfall-bar-track';

    const fill = document.createElement('div');
    fill.className = `waterfall-bar-fill bar-${item.service}`;

    const leftPercent = Math.min((item.startMs / totalTime) * 100, 95);
    const widthPercent = Math.max((item.durationMs / totalTime) * 100, 2);

    fill.style.left = `${leftPercent}%`;
    fill.style.width = `${widthPercent}%`;
    fill.textContent = `${item.durationMs}ms`;

    track.appendChild(fill);

    const time = document.createElement('div');
    time.className = 'waterfall-time';
    time.textContent = `${item.startMs} - ${item.startMs + item.durationMs}ms`;

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(time);
    waterfallChart.appendChild(row);
  }
}

function renderViews(res) {
  const { user, orders } = res.data;

  // 1. Web View
  if (user) {
    let ordersHtml = '';
    for (const ord of (orders || [])) {
      let itemsHtml = '';
      for (const it of (ord.items || [])) {
        const prod = it.product;
        if (prod) {
          itemsHtml += `
            <div class="order-item-row">
              <img src="${prod.thumbnailUrl || ''}" class="product-thumb" alt="Product">
              <div class="product-info">
                <div class="product-name">${prod.name}</div>
                <div class="product-meta">Mã: ${prod.id} • SL: ${it.quantity} • Giá: ${prod.price?.toLocaleString()} đ</div>
              </div>
              <div class="product-price">${((it.quantity || 1) * (prod.price || 0)).toLocaleString()} đ</div>
            </div>
          `;
        } else {
          itemsHtml += `
            <div class="order-item-row">
              <div class="product-thumb" style="display:flex;align-items:center;justify-content:center;color:#ef4444;">⚠️</div>
              <div class="product-info">
                <div class="product-name" style="color:#ef4444;">[Sản phẩm không khả dụng / null]</div>
                <div class="product-meta">Mã: ${it.productId} • SL: ${it.quantity || 1} • <span class="product-missing">Partial Failure: Không dùng dữ liệu giả</span></div>
              </div>
              <div class="product-price" style="color:var(--text-dim);">-</div>
            </div>
          `;
        }
      }

      ordersHtml += `
        <div class="order-card">
          <div class="order-header">
            <div>
              <span class="order-title">Đơn hàng #${ord.id}</span>
              <span class="order-date">• ${ord.orderDate || ''}</span>
            </div>
            <span class="order-status status-${(ord.status || 'pending').toLowerCase()}">${ord.status}</span>
          </div>
          <div class="order-items">${itemsHtml}</div>
        </div>
      `;
    }

    webDashboardView.innerHTML = `
      <div class="user-profile-banner">
        <img src="${user.avatar || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150'}" class="user-avatar" alt="Avatar">
        <div class="user-details">
          <h4>${user.name} (${user.id})</h4>
          <p>${user.email} • ${user.phone || ''}</p>
          <p style="font-size:12px;color:var(--text-dim);">${user.address || ''}</p>
        </div>
      </div>
      <div class="orders-list">${ordersHtml}</div>
    `;
  } else {
    webDashboardView.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--text-muted);">
        Chế độ Mobile App hoặc Không có dữ liệu Web Dashboard.
      </div>
    `;
  }

  // 2. Mobile View
  if (Array.isArray(orders) && orders.length > 0) {
    let mobileListHtml = `<div class="mobile-header">Đơn hàng của tôi (${orders.length})</div>`;
    for (const mOrder of orders) {
      const pName = mOrder.productName || (mOrder.items && mOrder.items[0]?.product?.name) || '[Chưa tải được tên]';
      const pThumb = mOrder.thumbnailUrl || (mOrder.items && mOrder.items[0]?.product?.thumbnailUrl) || '';
      const orderId = mOrder.orderId || mOrder.id || 'N/A';
      const status = mOrder.status || 'PENDING';

      mobileListHtml += `
        <div class="mobile-order-item">
          ${pThumb ? `<img src="${pThumb}" alt="thumb">` : `<div style="width:48px;height:48px;background:#334155;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#ef4444;">⚠️</div>`}
          <div class="mobile-order-details">
            <div class="mobile-order-id">Đơn #${orderId}</div>
            <div class="mobile-prod-name">${pName}</div>
            <div class="mobile-order-status">${status}</div>
          </div>
        </div>
      `;
    }
    mobileAppContent.innerHTML = mobileListHtml;
  } else {
    mobileAppContent.innerHTML = `
      <div class="mobile-header">Đơn hàng của tôi</div>
      <div style="color: var(--text-dim); font-size: 12px; text-align: center; margin-top: 30px;">
        Chưa có dữ liệu đơn hàng.
      </div>
    `;
  }
}

function renderTrace(res) {
  const trace = res.trace || {};
  let content = `[${new Date().toLocaleTimeString()}] ${res.variant} (${res.clientTarget.toUpperCase()})\n`;
  content += `► ${trace.summary || ''}\n\n`;
  content += `► Chi tiết Calls:\n`;
  if (trace.calls) {
    for (const c of trace.calls) {
      content += `  • ${c}\n`;
    }
  }
  traceLog.textContent = content;
}

// ----------------------------------------------------------------------------------
// BENCHMARK SUITE (5 RUNS PER VARIANT, COLD RUN + WARM RUNS, MEDIAN CALCULATION)
// ----------------------------------------------------------------------------------

async function runFullBenchmark() {
  const variants = [
    { key: 'baseline', name: 'Baseline (Client)', badge: 'badge-baseline' },
    { key: 'bff', name: 'BFF Service', badge: 'badge-bff' },
    { key: 'graphql-n1', name: 'GraphQL (N+1)', badge: 'badge-graphql-n1' },
    { key: 'graphql-dl', name: 'GraphQL (DataLoader)', badge: 'badge-graphql-dl' }
  ];

  const results = [];
  benchmarkTableBody.innerHTML = '';

  for (const v of variants) {
    benchmarkStatus.textContent = `Đang đo: ${v.name}...`;
    const runs = [];

    // Chạy 5 lần liên tiếp: Run 1 là Cold, Run 2-5 là Warm
    for (let i = 1; i <= 5; i++) {
      const res = await executeRun(v.key, state.dataset, state.client, state.chaos);
      runs.push(res);
      // Giãn cách nhỏ 50ms giữa các lần đo
      await new Promise(r => setTimeout(r, 50));
    }

    const coldDuration = runs[0].durationMs;
    const warmDurations = runs.slice(1).map(r => r.durationMs);

    // Tính median trên cả 5 lần
    const sortedDurations = [...runs.map(r => r.durationMs)].sort((a, b) => a - b);
    const medianDuration = sortedDurations[2]; // phần tử thứ 3 của 5 lần
    const minDuration = sortedDurations[0];
    const maxDuration = sortedDurations[4];

    const sample = runs[0];
    results.push({
      variant: v,
      clientRequests: sample.clientRequests,
      internalCalls: sample.internalCalls,
      dbQueries: sample.dbQueries,
      payloadBytes: sample.payloadBytes,
      coldDuration,
      warmDurations,
      medianDuration,
      range: `${minDuration} - ${maxDuration} ms`
    });

    // Render bảng ngay khi có kết quả từng dòng
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><span class="badge ${v.badge}">${v.name}</span></td>
      <td><strong>${sample.clientRequests}</strong></td>
      <td>${sample.internalCalls}</td>
      <td>${sample.dbQueries}</td>
      <td>${(sample.payloadBytes / 1024).toFixed(1)} KB</td>
      <td><span style="color:#60a5fa">${coldDuration} ms</span></td>
      <td style="font-size:11px;color:var(--text-dim);">${warmDurations.join(', ')} ms</td>
      <td><strong style="color:#34d399;font-size:14px;">${medianDuration} ms</strong> <span style="font-size:10px;color:var(--text-dim);">(${minDuration}-${maxDuration})</span></td>
    `;
    benchmarkTableBody.appendChild(row);
  }

  // Render kết quả mẫu của biến thể đang chọn
  const activeRes = await executeRun(state.variant, state.dataset, state.client, state.chaos);
  renderMetrics(activeRes);
  renderWaterfall(activeRes);
  renderViews(activeRes);
  renderTrace(activeRes);
}

// Khởi tạo chạy mẫu khi vừa load trang
window.addEventListener('DOMContentLoaded', () => {
  btnRunOnce.click();
});
