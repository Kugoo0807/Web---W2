# REPORT — API Composition

## 1. Lựa chọn kỹ thuật

Nhóm dùng **Node.js 22 + Express** để dựng các service REST/BFF và web server vì cùng dùng JavaScript với client, khởi động nhanh và phù hợp thời lượng thực hành. Nhóm không dùng Spring Boot cho bài này vì cấu hình project và vòng lặp build dài hơn không tạo thêm giá trị cho mục tiêu chính là so sánh nơi ghép dữ liệu.

Mỗi service sở hữu một file **SQLite** riêng. SQLite giúp dữ liệu mẫu có thể nạp lại bằng một lệnh, không cần dịch vụ ngoài; đổi lại kết quả chỉ có ý nghĩa đo local, không đại diện cho database phân tán hay tải đồng thời cao.

GraphQL dùng thư viện `graphql` và `DataLoader`. Chế độ `n1` gọi Product Service cho từng item để tái hiện N+1. Chế độ `dataloader` gom ID trong cùng request, khử trùng lặp và gọi endpoint batch một lần. Nhóm không dùng Apollo Server vì schema/resolver cần cho bài nhỏ và `graphql` đủ để trình bày cơ chế resolver + batching.

## 2. API documentation và logging

Nhóm không thêm Swagger/OpenAPI vì bộ API nhỏ và contract đã được mô tả trong `PLAN.md`/`README.md`; thêm UI Swagger không đóng góp vào phép đo API composition. Nếu phát triển tiếp, OpenAPI nên được thêm cho ba REST service và BFF.

Nhóm không triển khai ELK vì đây là demo localhost, không có log tập trung hay nhiều node. Thay vào đó, mỗi response composition trả telemetry gồm service call, DB query và thời lượng; script benchmark/chaos in raw output để lưu làm evidence. Trong môi trường production, telemetry này nên được thay bằng structured logging và hệ thống quan sát tập trung.

## 3. Policy lỗi

Policy thống nhất của BFF và GraphQL là **partial failure**. Nếu Product Service lỗi HTTP 500 hoặc quá timeout 1500 ms, User và Order vẫn được trả về; product tương ứng là `null` và response kèm `errors`. Không thay tên, giá hoặc ảnh bằng dữ liệu giả.

## 4. Cách đo và giới hạn

- Client request: số HTTP request từ client tới entry point của biến thể.
- Internal call: số HTTP call BFF/GraphQL gửi xuống User, Order và Product Service.
- DB query: tổng header telemetry `x-db-queries` từ downstream service.
- Payload: số byte UTF-8 của JSON response body, không gồm HTTP header/request body.
- Cold run: lần đầu của một biến thể ngay sau khi script khởi động lại các service; warm run là bốn lần tiếp theo không restart.

`BENCHMARK_REPORT.md` chứa năm lần chạy của mỗi kịch bản. Số ms trên localhost có thể dao động theo máy và tiến trình nền; chỉ so sánh các biến thể khi cùng dữ liệu, query fields và môi trường. Khi trình bày, dùng waterfall trong UI để xác định mốc màn hình hoàn tất sau khi DOM đã render.

## 5. Trade-off

Baseline đơn giản ở server nhưng làm client chatty và lộ contract nội bộ. BFF tối ưu response theo từng client nhưng tăng số endpoint phải bảo trì. GraphQL cho client chọn field linh hoạt, nhưng cần batch/dedup để tránh N+1 và cần kiểm soát query trong hệ thống lớn.
