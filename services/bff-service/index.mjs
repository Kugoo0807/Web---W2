import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:4002';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4003';
const PRODUCT_TIMEOUT_MS = 1500; // Timeout 1.5s for Product Service call

// Helper fetch với timeout và thu thập telemetry
async function fetchWithTelemetry(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 5000);

  const start = performance.now();
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const duration = Math.round(performance.now() - start);
    const dbQueries = parseInt(res.headers.get('x-db-queries') || '0', 10);
    const service = res.headers.get('x-service') || 'unknown';

    if (!res.ok) {
      throw new Error(`Service returned HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
      ok: true,
      data,
      metrics: {
        service,
        url,
        status: res.status,
        dbQueries,
        durationMs: duration
      }
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const duration = Math.round(performance.now() - start);
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'Timeout' : err.message,
      metrics: {
        service: 'downstream',
        url,
        status: err.name === 'AbortError' ? 408 : 500,
        dbQueries: 0,
        durationMs: duration
      }
    };
  }
}

export function createBffServiceApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // 1. WEB DASHBOARD ENDPOINT - Đầy đủ thông tin
  app.get('/api/web/dashboard', async (req, res) => {
    const t0 = performance.now();
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId query parameter' });
    }

    const serviceCallBreakdown = [];
    let totalDbQueries = 0;
    const errors = [];

    // Gọi song song User Service và Order Service
    const userStartMs = Math.round(performance.now() - t0);
    const userRequest = fetchWithTelemetry(`${USER_SERVICE_URL}/users/${encodeURIComponent(userId)}`);
    const orderStartMs = Math.round(performance.now() - t0);
    const orderRequest = fetchWithTelemetry(`${ORDER_SERVICE_URL}/orders?userId=${encodeURIComponent(userId)}`);
    const [userRes, orderRes] = await Promise.all([userRequest, orderRequest]);

    serviceCallBreakdown.push({ ...userRes.metrics, startMs: userStartMs });
    serviceCallBreakdown.push({ ...orderRes.metrics, startMs: orderStartMs });
    totalDbQueries += userRes.metrics.dbQueries + orderRes.metrics.dbQueries;

    if (!userRes.ok) {
      return res.status(userRes.metrics.status || 500).json({ error: 'User service error: ' + userRes.error });
    }
    const user = userRes.data;

    if (!orderRes.ok) {
      return res.status(orderRes.metrics.status || 500).json({ error: 'Order service error: ' + orderRes.error });
    }
    const orders = orderRes.data;

    // Trích xuất danh sách productId duy nhất (Deduplication)
    const productIdsSet = new Set();
    for (const order of orders) {
      for (const item of order.items || []) {
        if (item.productId) productIdsSet.add(item.productId);
      }
    }
    const uniqueProductIds = Array.from(productIdsSet);

    // Chuyển tiếp các cờ chaos nếu có
    const chaosHeaders = {};
    if (req.headers['x-chaos-delay']) chaosHeaders['x-chaos-delay'] = req.headers['x-chaos-delay'];
    if (req.headers['x-chaos-fault']) chaosHeaders['x-chaos-fault'] = req.headers['x-chaos-fault'];
    let chaosQuery = '';
    if (req.query.delay) chaosQuery += `&delay=${req.query.delay}`;
    if (req.query.fault) chaosQuery += `&fault=${req.query.fault}`;

    // Gọi Product Service theo batch (chỉ 1 service call dù có bao nhiêu đơn)
    let productMap = new Map();
    if (uniqueProductIds.length > 0) {
      const productStartMs = Math.round(performance.now() - t0);
      const prodRes = await fetchWithTelemetry(
        `${PRODUCT_SERVICE_URL}/products/batch?ids=${uniqueProductIds.join(',')}${chaosQuery}`,
        { headers: chaosHeaders, timeout: PRODUCT_TIMEOUT_MS }
      );
      serviceCallBreakdown.push({ ...prodRes.metrics, startMs: productStartMs });
      totalDbQueries += prodRes.metrics.dbQueries;

      if (prodRes.ok && Array.isArray(prodRes.data)) {
        for (const p of prodRes.data) {
          productMap.set(p.id, p);
        }
      } else {
        // Áp dụng Partial Failure Policy:
        // Đánh dấu lỗi, sản phẩm để null, không dùng dữ liệu giả
        errors.push({
          service: 'product-service',
          status: prodRes.metrics.status,
          message: `Không thể tải dữ liệu sản phẩm: ${prodRes.error}`,
          affectedProductIds: uniqueProductIds
        });
      }
    }

    // Ghép dữ liệu hoàn chỉnh cho Web Dashboard
    const enrichedOrders = orders.map(order => ({
      ...order,
      items: (order.items || []).map(item => ({
        ...item,
        product: productMap.get(item.productId) || null
      }))
    }));

    const durationMs = Math.round(performance.now() - t0);

    const payload = {
      client: 'web',
      user,
      orders: enrichedOrders,
      errors: errors.length > 0 ? errors : undefined,
      _metrics: {
        clientRequests: 1,
        serviceCalls: serviceCallBreakdown.length,
        dbQueries: totalDbQueries,
        durationMs,
        serviceCallBreakdown
      }
    };

    return res.json(payload);
  });

  // 2. MOBILE ORDERS ENDPOINT - Tinh gọn, chỉ gồm: orderId, status, productName, thumbnailUrl
  app.get('/api/mobile/orders', async (req, res) => {
    const t0 = performance.now();
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId query parameter' });
    }

    const serviceCallBreakdown = [];
    let totalDbQueries = 0;
    const errors = [];

    // Mobile chỉ cần Order Service và Product Service, không cần gọi User Service!
    const orderStartMs = Math.round(performance.now() - t0);
    const orderRes = await fetchWithTelemetry(`${ORDER_SERVICE_URL}/orders?userId=${encodeURIComponent(userId)}`);
    serviceCallBreakdown.push({ ...orderRes.metrics, startMs: orderStartMs });
    totalDbQueries += orderRes.metrics.dbQueries;

    if (!orderRes.ok) {
      return res.status(orderRes.metrics.status || 500).json({ error: 'Order service error: ' + orderRes.error });
    }
    const orders = orderRes.data;

    // Deduplication product IDs
    const productIdsSet = new Set();
    for (const order of orders) {
      for (const item of order.items || []) {
        if (item.productId) productIdsSet.add(item.productId);
      }
    }
    const uniqueProductIds = Array.from(productIdsSet);

    // Chuyển tiếp các cờ chaos nếu có
    const chaosHeaders = {};
    if (req.headers['x-chaos-delay']) chaosHeaders['x-chaos-delay'] = req.headers['x-chaos-delay'];
    if (req.headers['x-chaos-fault']) chaosHeaders['x-chaos-fault'] = req.headers['x-chaos-fault'];
    let chaosQuery = '';
    if (req.query.delay) chaosQuery += `&delay=${req.query.delay}`;
    if (req.query.fault) chaosQuery += `&fault=${req.query.fault}`;

    let productMap = new Map();
    if (uniqueProductIds.length > 0) {
      const productStartMs = Math.round(performance.now() - t0);
      const prodRes = await fetchWithTelemetry(
        `${PRODUCT_SERVICE_URL}/products/batch?ids=${uniqueProductIds.join(',')}${chaosQuery}`,
        { headers: chaosHeaders, timeout: PRODUCT_TIMEOUT_MS }
      );
      serviceCallBreakdown.push({ ...prodRes.metrics, startMs: productStartMs });
      totalDbQueries += prodRes.metrics.dbQueries;

      if (prodRes.ok && Array.isArray(prodRes.data)) {
        for (const p of prodRes.data) {
          productMap.set(p.id, p);
        }
      } else {
        errors.push({
          service: 'product-service',
          status: prodRes.metrics.status,
          message: `Không thể tải dữ liệu sản phẩm: ${prodRes.error}`
        });
      }
    }

    // Tinh gọn danh sách đơn cho Mobile App:
    // Chỉ gồm mã đơn (orderId), trạng thái (status), tên product (productName) và ảnh thumbnail (thumbnailUrl)
    const mobileOrders = [];
    for (const order of orders) {
      const items = order.items || [];
      if (items.length === 0) {
        mobileOrders.push({
          orderId: order.id,
          status: order.status,
          productName: null,
          thumbnailUrl: null
        });
      } else {
        // Nếu đơn có nhiều items, đưa từng item hoặc đại diện item chính
        for (const item of items) {
          const prod = productMap.get(item.productId);
          mobileOrders.push({
            orderId: order.id,
            status: order.status,
            productName: prod ? prod.name : null,
            thumbnailUrl: prod ? prod.thumbnailUrl : null
          });
        }
      }
    }

    const durationMs = Math.round(performance.now() - t0);

    const payload = {
      client: 'mobile',
      orders: mobileOrders,
      errors: errors.length > 0 ? errors : undefined,
      _metrics: {
        clientRequests: 1,
        serviceCalls: serviceCallBreakdown.length,
        dbQueries: totalDbQueries,
        durationMs,
        serviceCallBreakdown
      }
    };

    return res.json(payload);
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createBffServiceApp();
  const PORT = process.env.PORT || 4004;
  app.listen(PORT, () => {
    console.log(`[BFF Service] Chạy tại http://localhost:${PORT}`);
  });
}
