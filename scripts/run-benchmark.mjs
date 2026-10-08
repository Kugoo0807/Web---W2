import { startAllServers } from '../server.mjs';

const ENDPOINTS = {
  user: 'http://localhost:4001',
  order: 'http://localhost:4002',
  product: 'http://localhost:4003',
  bff: 'http://localhost:4004',
  graphql: 'http://localhost:4005'
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function closeServers(servers) {
  await Promise.all(Object.values(servers).map(server => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
}

// 1. Run Baseline
async function runBaseline(userId, clientTarget) {
  const t0 = performance.now();
  let clientRequests = 0;
  let internalCalls = 0;
  let dbQueries = 0;
  let payloadBytes = 0;

  // Step 1: User (web only)
  let user = null;
  if (clientTarget === 'web') {
    clientRequests++;
    const uRes = await fetch(`${ENDPOINTS.user}/users/${userId}`);
    dbQueries += parseInt(uRes.headers.get('x-db-queries') || '1', 10);
    user = await uRes.json();
    payloadBytes += JSON.stringify(user).length;
  }

  // Step 2: Orders
  clientRequests++;
  const oRes = await fetch(`${ENDPOINTS.order}/orders?userId=${userId}`);
  dbQueries += parseInt(oRes.headers.get('x-db-queries') || '2', 10);
  const orders = await oRes.json();
  payloadBytes += JSON.stringify(orders).length;

  // Step 3: Products (N+1 from client)
  const productMap = new Map();
  const allItems = orders.flatMap(o => o.items || []);
  for (const item of allItems) {
    clientRequests++;
    const pRes = await fetch(`${ENDPOINTS.product}/products/${item.productId}`);
    dbQueries += parseInt(pRes.headers.get('x-db-queries') || '1', 10);
    const prod = await pRes.json();
    payloadBytes += JSON.stringify(prod).length;
    productMap.set(item.productId, prod);
  }

  const durationMs = Math.round(performance.now() - t0);
  return {
    variant: 'Baseline',
    durationMs,
    clientRequests,
    internalCalls,
    dbQueries,
    payloadBytes
  };
}

// 2. Run BFF
async function runBff(userId, clientTarget) {
  const t0 = performance.now();
  const url = clientTarget === 'web'
    ? `${ENDPOINTS.bff}/api/web/dashboard?userId=${userId}`
    : `${ENDPOINTS.bff}/api/mobile/orders?userId=${userId}`;

  const res = await fetch(url);
  const text = await res.text();
  const payloadBytes = Buffer.byteLength(text, 'utf8');
  const json = JSON.parse(text);
  const durationMs = Math.round(performance.now() - t0);
  const metrics = json._metrics || {};

  return {
    variant: 'BFF',
    durationMs,
    clientRequests: 1,
    internalCalls: metrics.serviceCalls || 0,
    dbQueries: metrics.dbQueries || 0,
    payloadBytes
  };
}

// 3. Run GraphQL
async function runGraphql(userId, clientTarget, mode) {
  const t0 = performance.now();
  const webQuery = `
    query WebDashboard($userId: ID!) {
      user(id: $userId) { id name email phone address avatar }
      orders(userId: $userId) {
        id orderDate status shippingAddress paymentMethod totalAmount
        items { id quantity unitPrice product { id name price description category thumbnailUrl inStock } }
      }
    }
  `;
  const mobileQuery = `
    query MobileOrders($userId: ID!) {
      orders(userId: $userId) {
        id status items { product { name thumbnailUrl } }
      }
    }
  `;
  const query = clientTarget === 'web' ? webQuery : mobileQuery;

  const res = await fetch(`${ENDPOINTS.graphql}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-graphql-mode': mode
    },
    body: JSON.stringify({ query, variables: { userId } })
  });

  const text = await res.text();
  const payloadBytes = Buffer.byteLength(text, 'utf8');
  const json = JSON.parse(text);
  const durationMs = Math.round(performance.now() - t0);
  const metrics = (json.extensions && json.extensions.metrics) || {};

  return {
    variant: mode === 'n1' ? 'GraphQL (N+1)' : 'GraphQL (DataLoader)',
    durationMs,
    clientRequests: 1,
    internalCalls: metrics.serviceCalls || 0,
    dbQueries: metrics.dbQueries || 0,
    payloadBytes
  };
}

async function benchmarkScenario(datasetName, userId, clientTarget) {
  console.log(`\n======================================================`);
  console.log(` BENCHMARK: Dataset = ${datasetName.toUpperCase()} | Client = ${clientTarget.toUpperCase()}`);
  console.log(`======================================================`);

  const runners = [
    { name: 'Baseline', fn: () => runBaseline(userId, clientTarget) },
    { name: 'BFF', fn: () => runBff(userId, clientTarget) },
    { name: 'GraphQL (N+1)', fn: () => runGraphql(userId, clientTarget, 'n1') },
    { name: 'GraphQL (DataLoader)', fn: () => runGraphql(userId, clientTarget, 'dataloader') }
  ];

  const results = [];

  for (const r of runners) {
    process.stdout.write(`Đo [${r.name}] 5 lần... `);
    const runs = [];
    // Khởi động lại service cho từng biến thể: lần đầu thật sự là cold run.
    const servers = startAllServers();
    await sleep(300);
    try {
      for (let i = 0; i < 5; i++) {
        const runRes = await r.fn();
        runs.push(runRes);
        await sleep(40);
      }
    } finally {
      await closeServers(servers);
      await sleep(100);
    }

    const cold = runs[0].durationMs;
    const warm = runs.slice(1).map(x => x.durationMs);
    const sorted = [...runs.map(x => x.durationMs)].sort((a, b) => a - b);
    const median = sorted[2];
    const min = sorted[0];
    const max = sorted[4];

    const sample = runs[0];
    results.push({
      variant: r.name,
      clientRequests: sample.clientRequests,
      internalCalls: sample.internalCalls,
      dbQueries: sample.dbQueries,
      payloadBytes: sample.payloadBytes,
      cold,
      warm,
      median,
      min,
      max
    });

    console.log(`Xong! Median: ${median}ms (Khoảng: ${min}-${max}ms, Cold: ${cold}ms)`);
  }

  // In bảng Markdown
  console.log(`\n| Biến thể | Client Reqs | Internal Calls | DB Queries | Payload | Cold (1st) | Warm (2-5) | Median (Range) |`);
  console.log(`| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`);
  for (const res of results) {
    console.log(`| **${res.variant}** | ${res.clientRequests} | ${res.internalCalls} | ${res.dbQueries} | ${(res.payloadBytes / 1024).toFixed(1)} KB | ${res.cold} ms | ${res.warm.join(', ')} ms | **${res.median} ms** (${res.min}-${res.max} ms) |`);
  }

  return results;
}

export async function runAllBenchmarks() {
  const reportData = {};

  // 1. Small Dataset - Web
  reportData.smallWeb = await benchmarkScenario('Small (5 đơn)', 'u1', 'web');

  // 2. Small Dataset - Mobile
  reportData.smallMobile = await benchmarkScenario('Small (5 đơn)', 'u1', 'mobile');

  // 3. Large Dataset - Web
  reportData.largeWeb = await benchmarkScenario('Large (50 đơn)', 'u2', 'web');

  // 4. Large Dataset - Mobile
  reportData.largeMobile = await benchmarkScenario('Large (50 đơn)', 'u2', 'mobile');

  console.log('\n--- TẤT CẢ PHÉP ĐO ĐÃ HOÀN TẤT ---');
  return reportData;
}

if (process.argv[1] && process.argv[1].endsWith('run-benchmark.mjs')) {
  runAllBenchmarks().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
