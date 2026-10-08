# KẾ HOẠCH THIẾT KẾ & QUYẾT ĐỊNH KIẾN TRÚC (PLAN)
**Dự án**: Web nâng cao - Tuần 2 - Block 2: API Composition (Baseline, BFF, GraphQL)  
**Ngày lập**: 2026-10-08  
**Phương pháp**: Brainstorming và thống nhất giải pháp giữa Kỹ sư lập trình và AI Agent.

---

## 1. Bối cảnh và Yêu cầu bài toán

Màn hình Dashboard cần hiển thị:
- Thông tin người dùng (`User`).
- Danh sách đơn hàng (`Order`) của người dùng đó.
- Chi tiết thông tin sản phẩm (`Product`) tương ứng trong từng mục đơn hàng.

Hệ thống phục vụ 2 nhóm client:
1. **Web Dashboard**: Cần đầy đủ trường thông tin (User, chi tiết Order, địa chỉ, trạng thái, danh sách sản phẩm gồm ID, tên, giá, mô tả, danh mục, thumbnail, tình trạng tồn kho, số lượng, thành tiền).
2. **Mobile App**: Cần payload tinh gọn nhằm tiết kiệm băng thông và tối ưu CPU di động: chỉ cần `orderId`, `status`, `productName`, `thumbnailUrl`.

Hệ thống kiểm nghiệm qua 3 mô hình lấy dữ liệu:
1. **Baseline**: Client tự gọi tuần tự 3 service từ browser và tự ghép dữ liệu (Client-side Composition).
2. **BFF (Backend For Frontend)**: Server-side composition với endpoint chuyên biệt cho từng loại client (`/api/web/dashboard` và `/api/mobile/orders`).
3. **GraphQL**: Server-side composition qua 1 endpoint duy nhất `POST /graphql`, client chủ động khai báo query fields. Minh họa và giải quyết vấn đề **N+1 query** bằng DataLoader (Batching & Deduplication).

---

## 2. Các quyết định kiến trúc đã thống nhất

### Quyết định 1: Độc lập cơ sở dữ liệu (Database-per-Service)
- Mỗi microservice sở hữu CSDL SQLite riêng biệt bằng module chuẩn `node:sqlite` (tích hợp sẵn trong Node.js v22):
  - `user-service`: `data/users.db`
  - `order-service`: `data/orders.db`
  - `product-service`: `data/products.db`
- Tuyệt đối không cho phép cross-database JOIN hoặc query chéo giữa các service ở tầng DB. Mọi sự liên kết phải diễn ra ở tầng ứng dụng (Application Layer / Composition Layer).

### Quyết định 2: Error Policy khi Product Service chậm hoặc lỗi
- **Lựa chọn thống nhất**: **Partial Failure (Trả về dữ liệu một phần có cờ đánh dấu lỗi)**.
- **Quy tắc**:
  - Khi Product Service bị lỗi (500) hoặc timeout (> 1500ms):
    - Trả về thông tin User và danh sách Orders bình thường.
    - Trường `product` trong các Order item sẽ có giá trị `null`.
    - Kèm theo thông báo lỗi chi tiết trong mảng `errors` (hoặc trường `partial: true` kèm danh sách ID bị lỗi).
    - **Tuyệt đối không thay thế bằng tên hoặc giá giả** (tuân thủ nghiêm ngặt yêu cầu đề bài).
  - Áp dụng chính sách này thống nhất trên cả BFF và GraphQL.

### Quyết định 3: Bộ dữ liệu kiểm thử (Small vs Large Datasets)
- **Small Dataset (Bộ nhỏ)**:
  - User: `u1` (Alice Nguyen).
  - 5 đơn hàng (`o1` đến `o5`).
  - Sử dụng 3 sản phẩm (`p1`, `p2`, `p3`) được lặp lại giữa các đơn hàng để kiểm chứng khả năng **Deduplication** (loại bỏ truy vấn trùng lặp).
- **Large Dataset (Bộ lớn)**:
  - User: `u2` (Bob Tran).
  - 50 đơn hàng (`o101` đến `o150`).
  - Sử dụng 10 sản phẩm (`p1` đến `p10`) lặp lại nhiều lần.
  - Mục đích: Thể hiện sự bùng nổ số lượng request của N+1 và sự khác biệt rõ rệt về thời gian hoàn tất cũng như dung lượng payload.

### Quyết định 4: Cơ chế đếm Metrics minh bạch
1. **Client Requests**: Đếm số HTTP request gửi từ Browser/Client tới backend.
2. **Internal Service Calls**: Đếm số cuộc gọi HTTP nội bộ giữa các service (User, Order, Product).
3. **Database Queries**: Mỗi service tự đếm số câu lệnh SQL (`SELECT ...`) thực thi trong mỗi request, trả về qua header phản hồi `x-db-queries` và metadata telemetry `_metrics`.
4. **Mốc màn hình hoàn tất (Screen Completion Time)**:
   - Bắt đầu: Ngay khi kích hoạt hành động tải (`t0 = performance.now()`).
   - Kết thúc: Ngay khi toàn bộ dữ liệu cần thiết được tải về và render hoàn tất trên DOM (`t_finish = performance.now()`).
   - Thời gian hoàn tất = `t_finish - t0` (ms).
5. **Payload Size**: Dung lượng UTF-8 của JSON response body, không gồm HTTP header hoặc request body.

---

## 3. Thiết kế Schema & Contract các Service

### 3.1 User Service (Port 4001)
- **CSDL**: `users.db`
  - Bảng `users`: `id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, address TEXT, avatar TEXT`
- **Endpoints**:
  - `GET /users/:id`: Trả về thông tin user.
  - Trả kèm header `x-db-queries: 1`.

### 3.2 Order Service (Port 4002)
- **CSDL**: `orders.db`
  - Bảng `orders`: `id TEXT PRIMARY KEY, userId TEXT, orderDate TEXT, status TEXT, shippingAddress TEXT, paymentMethod TEXT`
  - Bảng `order_items`: `id TEXT PRIMARY KEY, orderId TEXT, productId TEXT, quantity INTEGER, unitPrice REAL`
- **Endpoints**:
  - `GET /orders?userId=:userId`: Trả về danh sách đơn hàng kèm danh sách item của từng đơn.
  - Trả kèm header `x-db-queries: 2` (1 query bảng `orders`, 1 query bảng `order_items`).

### 3.3 Product Service (Port 4003)
- **CSDL**: `products.db`
  - Bảng `products`: `id TEXT PRIMARY KEY, name TEXT, price REAL, description TEXT, category TEXT, thumbnailUrl TEXT, inStock INTEGER`
- **Endpoints**:
  - `GET /products/:id`: Lấy chi tiết 1 sản phẩm. (1 DB query).
  - `GET /products/batch?ids=p1,p2,...`: Lấy theo danh sách ID bằng 1 query `IN (...)`. (1 DB query).
- **Chaos Injection**:
  - Query param `?delay=2000` hoặc header `x-chaos-delay: 2000` (giả lập độ trễ).
  - Query param `?fault=500` hoặc header `x-chaos-fault: 500` (giả lập lỗi 500).

### 3.4 BFF Service (Port 4004)
- **Endpoint Web**: `GET /api/web/dashboard?userId=:userId`
  - Gọi User Service & Order Service.
  - Trích xuất danh sách `productId` duy nhất (dedup).
  - Gọi Product Service (hỗ trợ batch endpoint).
  - Ghép đầy đủ thông tin: User + Orders + Product details.
- **Endpoint Mobile**: `GET /api/mobile/orders?userId=:userId`
  - Gọi Order Service.
  - Lấy thông tin `name` và `thumbnailUrl` từ Product Service.
  - Chỉ lọc trả về đúng 4 trường: `orderId`, `status`, `productName`, `thumbnailUrl`.

### 3.5 GraphQL Service (Port 4005)
- **Endpoint**: `POST /graphql`
- **Cơ chế tái hiện N+1 và DataLoader**:
  - Header `x-graphql-mode: n1` hoặc query param `mode=n1`: Resolver gọi `GET /products/:id` từng lần lặp (Tái hiện lỗi N+1).
  - Header `x-graphql-mode: dataloader` hoặc query param `mode=dataloader`: Resolver gom các `productId` trong 1 tick, loại trùng (dedup), gọi `GET /products/batch?ids=...` (Giải quyết triệt để N+1).

---

## 4. Kế hoạch Hiện thực (Implementation Steps)

1. **Khởi tạo mã nguồn & Dependencies**: Cài đặt `express`, `cors`, `dataloader`, `graphql`, v.v.
2. **Khởi tạo dữ liệu SQLite**: Viết script `seed-db.mjs` tạo bảng và dữ liệu mẫu (Small & Large dataset).
3. **Hiện thực 3 Core Services**: User Service, Order Service, Product Service (có telemetry & chaos simulation).
4. **Hiện thực Baseline Client**: Luồng gọi từ browser (User -> Order -> N Products) và đo đạc.
5. **Hiện thực BFF Service**: 2 endpoint cho Web & Mobile với deduplication.
6. **Hiện thực GraphQL Service**: Schema, Resolvers, N+1 demo mode vs DataLoader mode.
7. **Giao diện Dashboard & Testbed UI**:
   - Web Dashboard hiển thị dữ liệu đầy đủ.
   - Mobile View mô phỏng giao diện app di động.
   - Waterfall visualizer (biểu đồ thác nước hiển thị thời gian từng chặng).
   - Công cụ Chaos Testing (bật/tắt lỗi hoặc độ trễ Product Service).
   - Nút Benchmark tự động chạy 5 lần, tính median, min, max.
8. **Chạy benchmark, thu thập số liệu thực tế**: Ghi nhận bảng kết quả vào `BENCHMARK_REPORT.md` và `EVIDENCE.md`.
9. **Hoàn thiện tài liệu**: `README.md` và `SLIDES_OUTLINE.md`.
