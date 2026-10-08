# BÁO CÁO KẾT QUẢ ĐO ĐẠC & BENCHMARK

**Hệ thống:** Windows 11, Node.js v22.19.0, SQLite, Express, GraphQL, DataLoader  
**Ngày chạy:** 2026-10-08  
**Lệnh chạy:** `node scripts/run-benchmark.mjs`

## 1. Cách đo

- Mỗi biến thể được khởi động lại toàn bộ service trước lần 1. Lần 1 là **cold run**; lần 2–5 là **warm run**.
- Client request là HTTP request từ test runner vào service/entry point. Internal call là HTTP call BFF/GraphQL xuống các service. DB query là tổng `x-db-queries` từ response downstream.
- Payload là byte UTF-8 của JSON response body, không gồm header hay request body.
- Các bảng dưới đo thời điểm nhận xong response ở test runner. Mốc màn hình hoàn tất được quan sát tại UI sau khi render và paint; waterfall tương tác dùng để trình bày phần này.

## 2. Dữ liệu đo thô

### Small dataset — Web (u1, 5 đơn / 8 items)

| Biến thể | Client Reqs | Internal Calls | DB Queries | Payload | Cold | Warm (2–5) | Median (range) |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| Baseline | 10 | 0 | 11 | 4.0 KB | 161 ms | 22, 39, 18, 27 ms | **27 ms** (18–161) |
| BFF | 1 | 3 | 4 | 4.7 KB | 24 ms | 12, 13, 9, 6 ms | **12 ms** (6–24) |
| GraphQL (N+1) | 1 | 10 | 11 | 5.3 KB | 100 ms | 35, 37, 36, 32 ms | **36 ms** (32–100) |
| GraphQL (DataLoader) | 1 | 3 | 4 | 4.4 KB | 33 ms | 17, 12, 14, 14 ms | **14 ms** (12–33) |

### Small dataset — Mobile (u1, 5 đơn / 8 items)

| Biến thể | Client Reqs | Internal Calls | DB Queries | Payload | Cold | Warm (2–5) | Median (range) |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| Baseline | 9 | 0 | 10 | 3.7 KB | 29 ms | 19, 17, 23, 20 ms | **20 ms** (17–29) |
| BFF | 1 | 2 | 3 | 1.8 KB | 17 ms | 4, 10, 9, 8 ms | **9 ms** (4–17) |
| GraphQL (N+1) | 1 | 9 | 10 | 2.6 KB | 44 ms | 21, 25, 18, 21 ms | **21 ms** (18–44) |
| GraphQL (DataLoader) | 1 | 2 | 3 | 1.8 KB | 18 ms | 14, 15, 10, 13 ms | **14 ms** (10–18) |

### Large dataset — Web (u2, 50 đơn / 125 items)

| Biến thể | Client Reqs | Internal Calls | DB Queries | Payload | Cold | Warm (2–5) | Median (range) |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| Baseline | 127 | 0 | 128 | 54.1 KB | 317 ms | 182, 225, 269, 260 ms | **260 ms** (182–317) |
| BFF | 1 | 3 | 4 | 58.6 KB | 18 ms | 13, 12, 17, 16 ms | **16 ms** (12–18) |
| GraphQL (N+1) | 1 | 127 | 128 | 69.3 KB | 300 ms | 119, 207, 121, 201 ms | **201 ms** (119–300) |
| GraphQL (DataLoader) | 1 | 3 | 4 | 53.7 KB | 33 ms | 15, 27, 23, 18 ms | **23 ms** (15–33) |

### Large dataset — Mobile (u2, 50 đơn / 125 items)

| Biến thể | Client Reqs | Internal Calls | DB Queries | Payload | Cold | Warm (2–5) | Median (range) |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| Baseline | 126 | 0 | 127 | 53.8 KB | 193 ms | 225, 183, 207, 213 ms | **207 ms** (183–225) |
| BFF | 1 | 2 | 3 | 22.7 KB | 18 ms | 7, 9, 9, 9 ms | **9 ms** (7–18) |
| GraphQL (N+1) | 1 | 126 | 127 | 36.5 KB | 254 ms | 174, 144, 154, 135 ms | **154 ms** (135–254) |
| GraphQL (DataLoader) | 1 | 2 | 3 | 20.9 KB | 24 ms | 16, 9, 12, 18 ms | **16 ms** (9–24) |

## 3. Nhận xét

Với Large/Web, DataLoader giảm GraphQL từ 127 xuống 3 internal call và từ 128 xuống 4 DB query. BFF vẫn chỉ có một client request nhưng trả payload Web đầy đủ; response Mobile BFF giảm từ 58.6 KB xuống 22.7 KB. Các số ms là kết quả localhost nên được báo kèm khoảng giá trị, không dùng để suy luận cho môi trường Internet thực tế.
