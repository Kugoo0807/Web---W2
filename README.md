# Bài tập Block 2: API Composition (Baseline, BFF, GraphQL)

Dự án triển khai bài tập thực hành môn **Web nâng cao (Tuần 2, Block 2)**. Hệ thống bao gồm 3 microservices độc lập kèm CSDL riêng biệt, so sánh 3 mô hình lấy dữ liệu (**Baseline**, **BFF**, **GraphQL**) cho 2 loại client (**Web Dashboard** và **Mobile App**), giải quyết bài toán **N+1 query** bằng **DataLoader**, và kiểm thử khả năng chịu lỗi (**Chaos Testing**).

---

## 1. Cấu trúc Dự án

```text
Week2/
├── PLAN.md                    # Bản kế hoạch kiến trúc & các quyết định đã chốt với agent
├── REPORT.md                  # Giải thích các lựa chọn kỹ thuật và giới hạn
├── REPORT.html                # Bản HTML của REPORT.md để trình bày/nộp
├── BENCHMARK_REPORT.md        # Báo cáo đo thô chi tiết 5 lần chạy (Median, Min, Max, Payload)
├── EVIDENCE.md                # Bằng chứng N+1 trace, call graph BFF, đối chiếu Web/Mobile & Chaos test
├── SLIDES_OUTLINE.md          # Dàn ý bài thuyết trình 5 phần (Problem, Solution, Demo, Evidence, Trade-off)
├── README.md                  # Hướng dẫn khởi chạy & tài liệu hệ thống
├── package.json               # Cấu hình dự án & scripts thực thi
├── server.mjs                 # File khởi động master chạy đồng thời 5 service + Web UI
├── services/
│   ├── user-service/          # Port 4001: Quản lý thông tin User (users.db)
│   ├── order-service/         # Port 4002: Quản lý đơn hàng (orders.db)
│   ├── product-service/       # Port 4003: Quản lý sản phẩm & Chaos simulator (products.db)
│   ├── bff-service/           # Port 4004: Endpoint Web & Mobile, Deduplication & Batching
│   └── graphql-service/       # Port 4005: POST /graphql, chế độ N+1 vs DataLoader
├── public/                    # Giao diện Web Studio, Waterfall Visualizer, Mobile Simulator
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── scripts/
    ├── seed-db.mjs            # Khởi tạo CSDL SQLite độc lập cho 3 service
    ├── run-benchmark.mjs      # Script tự động đo 5 lần cho 4 biến thể trên 2 dataset
    └── chaos-test.mjs         # Script kiểm thử lỗi Product Service (500 fault & 2s delay)
```

---

## 2. Danh mục Cổng & Dịch vụ (Ports Allocation)

| Dịch vụ | Cổng | CSDL SQLite | Mô tả chức năng |
| :--- | :---: | :---: | :--- |
| **User Service** | `4001` | `data/users.db` | Cung cấp API `GET /users/:id` |
| **Order Service** | `4002` | `data/orders.db` | Cung cấp API `GET /orders?userId=:userId` |
| **Product Service** | `4003` | `data/products.db` | Single fetch `/products/:id`, Batch fetch `/products/batch` & Chaos |
| **BFF Service** | `4004` | *Không có DB* | Web `/api/web/dashboard` & Mobile `/api/mobile/orders` |
| **GraphQL Service**| `4005` | *Không có DB* | `POST /graphql` (Hỗ trợ mode `n1` và `dataloader`) |
| **Web UI & Studio**| `3000` | *Không có DB* | Dashboard trực quan, Biểu đồ thác nước & Testbed |

---

## 3. Hướng dẫn Khởi chạy Toàn bộ Hệ thống

### Bước 1: Cài đặt thư viện
```bash
npm install
```

### Bước 2: Nạp dữ liệu vào các CSDL SQLite
```bash
npm run seed
```
*(Script sẽ tạo 3 file CSDL riêng biệt trong thư mục `data/` với bộ dữ liệu nhỏ 5 đơn và bộ lớn 50 đơn hàng)*.

### Bước 3: Khởi chạy tất cả các Microservices và Giao diện
```bash
npm start
```
Truy cập trình duyệt tại địa chỉ: **[http://localhost:3000](http://localhost:3000)**

---

## 4. Các lệnh Kiểm thử Tự động

### Chạy kiểm tra Benchmark (5 lần đo mỗi kịch bản)
```bash
npm run benchmark
```
*Script sẽ tự động chạy 5 lần đo trên cả 4 biến thể, 2 loại dataset (nhỏ/lớn), 2 loại client (web/mobile), xuất bảng Markdown tính Median, Cold run, Warm runs và Min-Max.*

### Chạy kiểm tra Chịu lỗi (Chaos Testing)
```bash
npm run test-chaos
```
*Kiểm chứng chính sách Partial Failure khi Product Service gặp lỗi HTTP 500 hoặc bị chậm quá thời gian timeout 1500ms.*

---

## 5. Kết quả và evidence

Kết quả đo thô 5 lần (cold/warm, median và range) được ghi trong `BENCHMARK_REPORT.md`. Trace N+1, call graph BFF, đối chiếu Web/Mobile và chaos test nằm trong `EVIDENCE.md`.

> Xem [PLAN.md](PLAN.md), [REPORT.md](REPORT.md), [BENCHMARK_REPORT.md](BENCHMARK_REPORT.md), [EVIDENCE.md](EVIDENCE.md), và [SLIDES_OUTLINE.md](SLIDES_OUTLINE.md).
