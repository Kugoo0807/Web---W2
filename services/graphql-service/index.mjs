import express from 'express';
import cors from 'cors';
import DataLoader from 'dataloader';
import { graphql, buildSchema } from 'graphql';
import { fileURLToPath } from 'node:url';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:4002';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4003';
const PRODUCT_TIMEOUT_MS = 1500;

// Schema Definition
const schema = buildSchema(`
  type User {
    id: ID!
    name: String!
    email: String!
    phone: String
    address: String
    avatar: String
  }

  type Product {
    id: ID!
    name: String!
    price: Float!
    description: String
    category: String
    thumbnailUrl: String
    inStock: Int
  }

  type OrderItem {
    id: ID!
    orderId: String!
    productId: String!
    quantity: Int!
    unitPrice: Float!
    product: Product
  }

  type Order {
    id: ID!
    userId: String!
    orderDate: String!
    status: String!
    shippingAddress: String
    paymentMethod: String
    totalAmount: Float!
    items: [OrderItem!]!
  }

  type Query {
    user(id: ID!): User
    orders(userId: ID!): [Order!]!
  }
`);

// Helper fetch kèm timeout và telemetry
async function fetchWithTelemetry(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 5000);
  const start = performance.now();

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    const duration = Math.round(performance.now() - start);
    const dbQueries = parseInt(res.headers.get('x-db-queries') || '0', 10);
    const service = res.headers.get('x-service') || 'unknown';

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
      ok: true,
      data,
      metrics: { service, url, status: res.status, dbQueries, durationMs: duration, startMs: options.traceStartMs === undefined ? undefined : Math.round(start - options.traceStartMs) }
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const duration = Math.round(performance.now() - start);
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'Timeout' : err.message,
      metrics: { service: 'product-service', url, status: err.name === 'AbortError' ? 408 : 500, dbQueries: 0, durationMs: duration, startMs: options.traceStartMs === undefined ? undefined : Math.round(start - options.traceStartMs) }
    };
  }
}

// DataLoader batch function (Batching & Deduplication)
function createProductLoader(context) {
  return new DataLoader(async (ids) => {
    // ids đã được DataLoader gom lại và giữ thứ tự
    // Dedup IDs trước khi gửi request batch
    const uniqueIds = Array.from(new Set(ids));
    const url = `${PRODUCT_SERVICE_URL}/products/batch?ids=${uniqueIds.join(',')}${context.chaosQuery || ''}`;

    const res = await fetchWithTelemetry(url, { headers: context.chaosHeaders || {}, timeout: PRODUCT_TIMEOUT_MS, traceStartMs: context.t0 });
    context.metrics.serviceCalls++;
    context.metrics.serviceCallBreakdown.push(res.metrics);
    context.metrics.dbQueries += res.metrics.dbQueries;

    if (!res.ok) {
      // Partial Failure: Ghi nhận lỗi và trả về null cho từng ID
      context.errors.push({
        message: `Product Service Batch Failed: ${res.error}`,
        service: 'product-service',
        status: res.metrics.status
      });
      return ids.map(() => null);
    }

    const map = new Map();
    if (Array.isArray(res.data)) {
      for (const item of res.data) {
        map.set(item.id, item);
      }
    }

    return ids.map(id => map.get(id) || null);
  }, {
    cache: true // Tự động cache/dedup trong phạm vi 1 request duy nhất
  });
}

// Resolvers
const rootResolvers = {
  user: async ({ id }, context) => {
    const res = await fetchWithTelemetry(`${USER_SERVICE_URL}/users/${encodeURIComponent(id)}`, { traceStartMs: context.t0 });
    context.metrics.serviceCalls++;
    context.metrics.serviceCallBreakdown.push(res.metrics);
    context.metrics.dbQueries += res.metrics.dbQueries;

    if (!res.ok) {
      throw new Error(`User Service: ${res.error}`);
    }
    return res.data;
  },

  orders: async ({ userId }, context) => {
    const res = await fetchWithTelemetry(`${ORDER_SERVICE_URL}/orders?userId=${encodeURIComponent(userId)}`, { traceStartMs: context.t0 });
    context.metrics.serviceCalls++;
    context.metrics.serviceCallBreakdown.push(res.metrics);
    context.metrics.dbQueries += res.metrics.dbQueries;

    if (!res.ok) {
      throw new Error(`Order Service: ${res.error}`);
    }

    const orders = res.data;

    // Chuẩn bị trường items có resolver con cho product
    return orders.map(order => ({
      ...order,
      items: (order.items || []).map(item => ({
        ...item,
        product: async () => {
          // Xử lý tùy theo chế độ: N+1 hay DataLoader
          if (context.mode === 'n1') {
            // TÁI HIỆN N+1 PROBLEM:
            // Mỗi order item tự gọi 1 HTTP request riêng tới Product Service
            const singleRes = await fetchWithTelemetry(
              `${PRODUCT_SERVICE_URL}/products/${encodeURIComponent(item.productId)}${context.chaosQuery || ''}`,
              { headers: context.chaosHeaders || {}, timeout: PRODUCT_TIMEOUT_MS, traceStartMs: context.t0 }
            );
            context.metrics.serviceCalls++;
            context.metrics.serviceCallBreakdown.push(singleRes.metrics);
            context.metrics.dbQueries += singleRes.metrics.dbQueries;

            if (!singleRes.ok) {
              context.errors.push({
                message: `Product Service Single Fetch Failed for ${item.productId}: ${singleRes.error}`,
                service: 'product-service'
              });
              return null; // Partial Failure: Không dùng giá trị giả
            }
            return singleRes.data;
          } else {
            // GIẢI PHÁP DATALOADER (Batching & Dedup):
            return context.productLoader.load(item.productId);
          }
        }
      }))
    }));
  }
};

export function createGraphqlServiceApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.post('/graphql', async (req, res) => {
    const t0 = performance.now();
    const { query, variables, operationName } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Missing query in request body' });
    }

    // Xác định chế độ: 'n1' hoặc 'dataloader' (mặc định 'dataloader')
    const mode = req.headers['x-graphql-mode'] || req.query.mode || 'dataloader';

    const chaosHeaders = {};
    if (req.headers['x-chaos-delay']) chaosHeaders['x-chaos-delay'] = req.headers['x-chaos-delay'];
    if (req.headers['x-chaos-fault']) chaosHeaders['x-chaos-fault'] = req.headers['x-chaos-fault'];
    let chaosQuery = '';
    if (req.query.delay) chaosQuery += `&delay=${req.query.delay}`;
    if (req.query.fault) chaosQuery += `&fault=${req.query.fault}`;

    const context = {
      t0,
      mode,
      chaosHeaders,
      chaosQuery,
      metrics: {
        serviceCalls: 0,
        dbQueries: 0,
        serviceCallBreakdown: []
      },
      errors: []
    };

    if (mode !== 'n1') {
      context.productLoader = createProductLoader(context);
    }

    const result = await graphql({
      schema,
      source: query,
      rootValue: rootResolvers,
      contextValue: context,
      variableValues: variables,
      operationName
    });

    const durationMs = Math.round(performance.now() - t0);

    // Bổ sung telemetry extension
    const responsePayload = {
      ...result,
      extensions: {
        metrics: {
          clientRequests: 1,
          mode,
          serviceCalls: context.metrics.serviceCalls,
          dbQueries: context.metrics.dbQueries,
          durationMs,
          serviceCallBreakdown: context.metrics.serviceCallBreakdown
        }
      }
    };

    // Ghép errors nếu có phát sinh từ partial failure
    if (context.errors.length > 0) {
      responsePayload.errors = [...(responsePayload.errors || []), ...context.errors];
    }

    return res.json(responsePayload);
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createGraphqlServiceApp();
  const PORT = process.env.PORT || 4005;
  app.listen(PORT, () => {
    console.log(`[GraphQL Service] Chạy tại http://localhost:${PORT}`);
  });
}
