# 🔥 HƯỚNG DẪN SỬ DỤNG TIKTOK SPARKFLOW (VIỆT NAM)

Hệ thống tự động gửi tin nhắn giữ chuỗi ngọn lửa (Streak) trên **TikTok Việt Nam** vào đúng **05:00 sáng** hàng ngày, có giao diện Web trực quan.

---

## 1. Khởi động nhanh (1-Click)

1. Nhấp đúp chuột vào file:
   👉 **`start_tiktok_bot.bat`** (ở thư mục gốc dự án).
2. Trình duyệt sẽ tự động mở trang quản trị: **`http://localhost:8787`**.

---

## 2. Các bước thiết lập ban đầu (Chỉ cần làm 1 lần)

### Bước 1: Đăng nhập tài khoản TikTok
1. Trên giao diện Web `http://localhost:8787`, bấm nút: **`🔓 Mở Trình Duyệt Đăng Nhập`**.
2. Một cửa sổ trình duyệt Chromium sẽ hiện lên trang quét mã QR của TikTok (`tiktok.com/login/qrcode`).
3. Mở ứng dụng **TikTok trên điện thoại** -> vào **Hồ sơ** -> **Cài đặt & Quyền riêng tư** -> **Mã QR** -> Quét mã trên màn hình máy tính để đăng nhập.
4. Sau khi đăng nhập thành công, trình duyệt sẽ lưu vĩnh viễn phiên đăng nhập (Cookie) vào thư mục `state/tiktok_profile`. Bạn có thể đóng cửa sổ đăng nhập này lại.

### Bước 2: Cài đặt giờ gửi & Bạn bè
- **Giờ gửi hàng ngày**: Mặc định là **`05:00`** sáng (bạn có thể đổi thành giờ khác nếu muốn).
- **Người nhận**:
  - *Mặc định*: Tự động gửi cho **5 cuộc hội thoại gần nhất** trong hộp thư TikTok.
  - *Hoặc chỉ định cụ thể*: Nhập tên hiển thị hoặc username bạn bè vào ô (ví dụ: `Nguyễn Văn A, Lan Hương`).
- **Mẫu tin nhắn**: Nhập danh sách tin nhắn mẫu (mỗi dòng 1 câu, bot sẽ chọn ngẫu nhiên để tránh bị TikTok đánh dấu spam).
- Bấm nút **`💾 Lưu Cấu Hình`**.

### Bước 3: Kiểm tra gửi thử
- Bấm nút **`🚀 Gửi Thử Ngay`** ở góc trên bên phải.
- Bot sẽ mở TikTok Messages, tìm người nhận và gửi thử 1 tin nhắn.
- Bạn có thể xem kết quả trực tiếp trong ô **Nhật Ký Hoạt Động (Live Logs)** bên dưới.

---

## 2. Quản lý 2 tài khoản độc lập
- Ứng dụng hỗ trợ đồng thời **Acc 1** và **Acc 2**.
- Mỗi tài khoản có:
  - File đăng nhập riêng biệt (`state/tiktok_profile` & `state/tiktok_profile_acc2`).
  - Danh sách bạn bè riêng, quét và chọn bạn bè riêng bằng chip UI.
  - Phím tắt đăng nhập tiện lợi ngay ngoài Desktop: `DANG_NHAP_TIKTOK.bat` và `DANG_NHAP_ACC_2.bat`.
  - Phím tắt chạy bot ngoài Desktop: `CHAY_BOT_TIKTOK.bat`.

---

## 3. Hoạt động hàng ngày lúc 5h sáng

- Bộ lập lịch (`Scheduler`) chạy ngầm trong ứng dụng.
- Đúng **05:00 sáng**, bot sẽ tự động gửi tin nhắn cho **Acc 1**, sau đó nghỉ 10 giây và tiếp tục gửi cho **Acc 2**.
- Kết quả được lưu vào `logs/tiktok_bot.log` và hiển thị trên Web Dashboard.

