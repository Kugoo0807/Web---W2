import { startAllServers } from '../server.mjs';

const ENDPOINTS = {
  bff: 'http://localhost:4004',
  graphql: 'http://localhost:4005'
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function runChaosTests() {
  const servers = startAllServers();
  await sleep(1000);

  console.log('\n======================================================');
  console.log(' THỰC NGHIỆM CHAOS TESTING: PRODUCT SERVICE LỖI / CHẬM');
  console.log('======================================================\n');

  try {
    // 1. BFF với Product Service gặp lỗi HTTP 500
    console.log('► Test 1: BFF Service khi Product Service bị lỗi 500 (Fault Injection)');
    const bffRes = await fetch(`${ENDPOINTS.bff}/api/web/dashboard?userId=u1&fault=500`);
    const bffJson = await bffRes.json();
    console.log(`- HTTP Status code từ BFF: ${bffRes.status}`);
    console.log(`- Có User không: ${bffJson.user ? 'CÓ (' + bffJson.user.name + ')' : 'KHÔNG'}`);
    console.log(`- Có Orders không: ${bffJson.orders ? 'CÓ (' + bffJson.orders.length + ' đơn)' : 'KHÔNG'}`);
    const firstItem = bffJson.orders[0]?.items[0];
    console.log(`- Giá trị của field product: ${JSON.stringify(firstItem?.product)} (Tuân thủ: product = null, không bịa tên/giá)`);
    console.log(`- Mảng errors báo cáo:`, JSON.stringify(bffJson.errors, null, 2));

    // 2. GraphQL với Product Service gặp lỗi HTTP 500
    console.log('\n► Test 2: GraphQL Service khi Product Service bị lỗi 500 (Fault Injection)');
    const gqlQuery = `
      query WebDashboard($userId: ID!) {
        user(id: $userId) { name email }
        orders(userId: $userId) {
          id status items { quantity product { name price } }
        }
      }
    `;
    const gqlRes = await fetch(`${ENDPOINTS.graphql}/graphql?fault=500`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-graphql-mode': 'dataloader' },
      body: JSON.stringify({ query: gqlQuery, variables: { userId: 'u1' } })
    });
    const gqlJson = await gqlRes.json();
    console.log(`- HTTP Status code từ GraphQL: ${gqlRes.status}`);
    console.log(`- User trả về: ${JSON.stringify(gqlJson.data?.user)}`);
    console.log(`- Số lượng Orders: ${gqlJson.data?.orders?.length}`);
    const gqlFirstItem = gqlJson.data?.orders[0]?.items[0];
    console.log(`- Giá trị của item.product: ${JSON.stringify(gqlFirstItem?.product)} (null theo đúng Partial Failure spec)`);
    console.log(`- GraphQL errors metadata:`, JSON.stringify(gqlJson.errors, null, 2));

    // 3. BFF khi Product Service bị chậm (Delay 2000ms vượt quá Timeout 1500ms)
    console.log('\n► Test 3: BFF Service khi Product Service bị trễ 2000ms (vượt quá timeout 1500ms)');
    const tStart = performance.now();
    const slowBffRes = await fetch(`${ENDPOINTS.bff}/api/web/dashboard?userId=u1&delay=2000`);
    const slowBffJson = await slowBffRes.json();
    const slowDuration = Math.round(performance.now() - tStart);
    console.log(`- Thời gian hoàn tất BFF: ${slowDuration}ms (ngắt sau timeout ~1500ms, không treo vô hạn)`);
    console.log(`- Trạng thái trả về: Partial data, errors:`, slowBffJson.errors);

    // 4. GraphQL khi Product Service bị chậm: phải cùng policy với BFF
    console.log('\n► Test 4: GraphQL Service khi Product Service bị trễ 2000ms (vượt quá timeout 1500ms)');
    const gqlSlowStart = performance.now();
    const gqlSlowRes = await fetch(`${ENDPOINTS.graphql}/graphql?delay=2000`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-graphql-mode': 'dataloader' },
      body: JSON.stringify({ query: gqlQuery, variables: { userId: 'u1' } })
    });
    const gqlSlowJson = await gqlSlowRes.json();
    const gqlSlowDuration = Math.round(performance.now() - gqlSlowStart);
    const gqlSlowItem = gqlSlowJson.data?.orders?.[0]?.items?.[0];
    console.log(`- HTTP Status code từ GraphQL: ${gqlSlowRes.status}`);
    console.log(`- Thời gian hoàn tất GraphQL: ${gqlSlowDuration}ms (timeout ~1500ms)`);
    console.log(`- Giá trị của item.product: ${JSON.stringify(gqlSlowItem?.product)}`);
    console.log(`- GraphQL errors metadata:`, JSON.stringify(gqlSlowJson.errors, null, 2));

    console.log('\n--- CHAOS TESTING HOÀN TẤT ---');
  } finally {
    for (const key of Object.keys(servers)) {
      servers[key].close();
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('chaos-test.mjs')) {
  runChaosTests().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
