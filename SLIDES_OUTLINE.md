# DÀN Ý BÁO CÁO THUYẾT TRÌNH (PRESENTATION OUTLINE)
**Chủ đề**: API Composition: Baseline vs BFF vs GraphQL  
**Cấu trúc 5 phần bắt buộc**: Problem ➔ Solution ➔ Demo ➔ Evidence ➔ Trade-off

---

## PHẦN 1: PROBLEM (VẤN ĐỀ)
- **Bối cảnh thực tế**:
  - Màn hình Dashboard hiện đại cần tổng hợp dữ liệu từ 3 dịch vụ độc lập: `User Service`, `Order Service`, và `Product Service` (mỗi dịch vụ quản lý CSDL riêng).
  - Có 2 loại client khác nhau cùng truy cập: **Web Dashboard** (cần đầy đủ chi tiết mọi trường) và **Mobile App** (chỉ cần danh sách đơn rút gọn với mã đơn, trạng thái, tên sản phẩm và ảnh thumbnail).
- **Hạn chế của mô hình Baseline (Client-side Composition)**:
  - Hiện tượng **Chatty Client**: Client phải tự thực hiện nhiều request nối tiếp qua mạng (User ➔ Orders ➔ N Products).
  - Với 50 đơn hàng, trình duyệt phải gửi đến **127 request**!
  - Lãng phí băng thông di động do over-fetching (tải về nhiều trường không cần dùng).
  - Rò rỉ kiến trúc nội bộ của hệ thống microservices ra ngoài internet.
  - Xử lý lỗi phân mảnh tại client.

---

## PHẦN 2: SOLUTION (GIẢI PHÁP)
- **Chuyển dịch việc ghép dữ liệu sang Server**:
  1. **Giải pháp BFF (Backend For Frontend)**:
     - Tạo endpoint chuyên biệt cho từng loại client:
       - Web: `GET /api/web/dashboard?userId=...` (Ghép đầy đủ thông tin).
       - Mobile: `GET /api/mobile/orders?userId=...` (Cắt tỉa chỉ còn đúng 4 trường cần thiết).
     - BFF gom nhóm các Product ID duy nhất (Deduplication) và chỉ gọi 1 request batch sang Product Service.
  2. **Giải pháp GraphQL**:
     - Cung cấp 1 endpoint duy nhất `POST /graphql` phục vụ linh hoạt cả Web và Mobile thông qua 2 câu query riêng.
     - **Vấn đề N+1**: Khi resolver duyệt từng item trong danh sách đơn, phát sinh N cuộc gọi lặp lại tới Product Service.
     - **Giải pháp DataLoader**: Gom tất cả Product ID trong cùng một frame/tick, khử trùng lặp và gọi 1 câu batch duy nhất.
  3. **Chính sách chịu lỗi thống nhất (Error Policy)**:
     - Áp dụng **Partial Failure**: Khi Product Service bị lỗi 500 hoặc chậm quá 1500ms, hệ thống vẫn trả về User và Orders, gán `product = null` kèm cảnh báo lỗi, không dùng dữ liệu giả mạo.

---

## PHẦN 3: DEMO (TRÌNH DIỄN THỰC TẾ)
- **Kịch bản Demo trực tiếp trên hệ thống**:
  1. **Demo Baseline**:
     - Mở giao diện `http://localhost:3000`.
     - Chọn Dataset Nhỏ (5 đơn hàng). Bấm "Chạy 1 lần".
     - Quan sát Biểu đồ Thác nước (Waterfall): Thấy rõ chuỗi request nối tiếp (User ➔ Order ➔ 8 request Product lẻ).
  2. **Demo BFF**:
     - Chuyển sang biến thể BFF. Bấm "Chạy 1 lần".
     - Waterfall co lại thành đúng 1 request từ Client. Thời gian hoàn tất giảm đáng kể.
     - Chuyển Client sang "Mobile App": Quan sát giao diện điện thoại và thấy payload giảm hơn 61% (từ 4.7 KB xuống 1.8 KB).
  3. **Demo GraphQL & Trực quan hóa N+1**:
     - Chạy GraphQL (N+1): Chỉ ra trên bảng console/trace 10 service calls nội bộ.
     - Chuyển sang GraphQL (DataLoader): Số call nội bộ rơi xuống còn đúng 3 calls!
  4. **Demo Chaos Testing**:
     - Chọn mục Chaos: "Product Service lỗi (HTTP 500)".
     - Chạy lại: Màn hình kích hoạt cảnh báo Partial Failure, User và Orders vẫn hiển thị, Product hiển thị trạng thái `null` có thông báo rõ ràng.

---

## PHẦN 4: EVIDENCE (BẰNG CHỨNG THỰC NGHIỆM)
- **Bảng số liệu đối chiếu thực tế (Bộ dữ liệu lớn 50 đơn hàng)**:
  - **Client Requests**: Baseline = **127 reqs** | BFF = **1 req** | GraphQL = **1 req**.
  - **Internal Service Calls**: GraphQL (N+1) = **127 calls** ➔ Sau khi dùng DataLoader = **3 calls**.
  - **Số truy vấn Database**: Giảm từ **128 queries** xuống còn **4 queries**.
  - **Thời gian nhận response (Median)**:
    - Baseline: 260 ms
    - GraphQL (N+1): 201 ms
    - GraphQL (DataLoader): **23 ms**
    - BFF: **16 ms**
  - **Dung lượng Payload cho Mobile (BFF)**: Giảm từ 58.6 KB xuống **22.7 KB** (giảm khoảng 61%).

---

## PHẦN 5: TRADE-OFF (ĐÁNH ĐỔI & BÀI HỌC)
- **BFF vs GraphQL**:
  - *BFF*: Tối ưu response theo từng client; nhưng tốn công bảo trì nhiều endpoint khi số lượng client tăng.
  - *GraphQL*: Linh hoạt cho frontend, 1 endpoint cho các query khác nhau; nhưng cần DataLoader để tránh N+1 và có chi phí xử lý query ở server.
- **Client-side vs Server-side Composition**:
  - Ghép tại server giảm số round-trip từ client, nhưng dồn thêm tải CPU và bộ nhớ lên tầng gateway.
- **Giới hạn phép đo**:
  - Do đo trên localhost, độ trễ mạng thực tế ngoài internet chưa được phản ánh đầy đủ.
