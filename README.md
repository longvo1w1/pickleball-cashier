# CourtDesk — Pickleball Cashier

Ứng dụng thu ngân tiếng Việt dùng Next.js App Router, TypeScript, Tailwind v4, shadcn/ui Button (Radix/CVA), MongoDB Atlas/Mongoose và Vercel. Không có chế độ dữ liệu giả hoặc fallback localStorage cho dữ liệu kinh doanh.

## Chạy local

Yêu cầu Node.js 24, npm và MongoDB replica set (Atlas hỗ trợ transaction).

```powershell
npm ci
Copy-Item .env.example .env.local
# Sửa MONGODB_URI trỏ tới database RIÊNG của ứng dụng.
node scripts/configure-local.mjs
npm run check:atlas
$env:ALLOW_SEED='true'
npm run seed
Remove-Item Env:ALLOW_SEED
npm run dev
```

Mở http://localhost:3000. `scripts/configure-local.mjs` tạo SESSION_SECRET và mật khẩu Admin ngẫu nhiên trong `.env.local` được Git bỏ qua; không in secrets. Xem `SEED_ADMIN_EMAIL` và `SEED_ADMIN_PASSWORD` trong file này để đăng nhập. Seed chỉ thêm tài khoản quản trị và catalog khi chưa tồn tại, không ghi đè giá hiện có, không tạo ca, khách hoặc giao dịch. Giữ `ALLOW_SEED=false` ngoài lệnh seed được chủ động thực hiện. Không dùng database từ hệ thống production khác.

## Quy trình vận hành

1. Admin tạo nhân viên (Manager/Cashier) ở Thiết lập. Manager quản lý danh mục, sản phẩm và kho.
2. Nhân viên mở ca, nhập tiền mặt đầu ca; mỗi loại chai đang bán lấy tồn đầu ca theo cấu hình (mặc định 24). Đối chiếu tồn thực tế; Manager ghi điều chỉnh có lý do nếu khác. Sản phẩm chai thêm giữa ca có tồn 0 và cần nhập bổ sung.
3. POS lấy giá phía server. Không đá/có đá cùng trừ một chai của sản phẩm. Trà đá pha chế, vé Social và sản phẩm khác không kiểm đếm chai.
4. Social: ghi tên và buổi tham gia, sau đó Thu tiền để đưa vào giỏ; hoặc thêm vé trực tiếp tại POS và điền tên từng khách. Tên tùy chọn vé phải là `Sáng`/`Tối`.
5. Tiền mặt/chuyển khoản/kết hợp phải bằng tổng đơn. Tiền chuyển khoản là số nhân viên xác nhận đã nhận; ứng dụng chưa tích hợp ngân hàng. Tiền mặt nhập là số ghi nhận vào quỹ, không gồm tiền trả lại khách.
6. Manager bàn giao quyền phụ trách ca cho nhân viên khác, lưu ghi chú/audit. Tiền và kho giữ nguyên trên cùng ca; giao dịch vẫn giữ đúng nhân viên thực hiện.
7. Chốt ca yêu cầu đếm đủ từng loại chai và tiền mặt. Thiếu/thừa = thực đếm − dự kiến. Ca đã chốt chỉ đọc; sửa kho chỉ thực hiện trong ca mở và luôn có lý do/audit.
8. Quản lý ca → Chi tiết lấy **toàn bộ giao dịch của đúng ca**, không bị giới hạn 200 đơn. Có báo cáo nước/Social sáng/tối/sản phẩm khác sau hoàn, danh sách Social và phương thức thu, kho và biến động, đối soát, ghi chú bàn giao; hỗ trợ Excel/CSV và in. Lịch sử ca có nút phân trang Ca cũ hơn/Ca mới hơn (50 ca/trang). Màn hình tổng hợp chung vẫn giới hạn 200 giao dịch; dùng báo cáo ca/xuất file để đối soát đầy đủ. Ngày dùng Asia/Ho_Chi_Minh (UTC+7).

## Phân quyền

| Tác vụ                                      | Cashier | Manager | Admin  |
| ------------------------------------------- | ------- | ------- | ------ |
| POS, Social, mở/chốt ca phụ trách           | Có      | Có      | Có     |
| Xem giao dịch cá nhân                       | Có      | Tất cả  | Tất cả |
| Quản lý catalog, điều chỉnh kho, bàn giao   | Không   | Có      | Có     |
| Báo cáo toàn bộ, audit, danh sách nhân viên | Không   | Có      | Có     |
| Tạo tài khoản và cấp vai trò                | Không   | Không   | Có     |

Hệ thống hiện quản lý một quầy/một ca mở tại một thời điểm; unique partial index bảo vệ điều kiện này. Chưa có chỉnh sửa/vô hiệu hóa tài khoản từ UI, đa cơ sở hoặc đồng bộ offline.

## Hoàn/hủy và tồn kho theo ca

- Giao dịch → Hoàn/hủy chỉ dành cho Manager/Admin và chỉ khi **ca gốc còn mở**. Hỗ trợ hoàn/hủy toàn bộ đơn, chưa hỗ trợ hoàn một phần tiền hoặc hoàn đơn thuộc ca đã chốt. Xóa món trong giỏ chưa thanh toán không tạo giao dịch và không trừ/hoàn kho.
- Hoàn tiền qua đúng số tiền mặt/chuyển khoản của đơn gốc. Người thao tác xác nhận hoàn tiền thực tế ngoài ứng dụng, ghi lý do và nhập riêng số chai nguyên thực nhận, bán lại được cho từng dòng; chai đã uống không tự nhập lại (mặc định 0).
- `Reversal` giữ chứng từ hoàn riêng (unique sale và idempotency key), snapshot tiền và số chai nhận lại. Đơn gốc giữ nguyên dòng hàng, giá và tiền gốc; chỉ cập nhật trạng thái. Tất cả thao tác hoàn tiền, hoàn kho, giảm quỹ ca và audit cùng transaction. Không thể hoàn một đơn hai lần, kể cả hai request dùng key khác nhau.
- `Stock.sold` là số lượng bán gốc, `returned` là số chai thực nhập lại. **Tồn dự kiến = đầu + nhập bổ sung − bán + hoàn kho + nhập điều chỉnh − xuất điều chỉnh**. `Movement` lưu shift, sản phẩm, người thực hiện, số lượng +/- và lý do; biến động bán/hoàn có tham chiếu đơn.
- Chốt ca đối chiếu tổng gốc trừ Reversal với cashSales/transferSales và đối chiếu công thức kho. Nếu sổ không khớp sẽ từ chối chốt, không tự sửa số liệu. Thực đếm tiền/chai và chênh lệch được lưu; ca chốt không nhận thêm bán, hoàn, điều chỉnh hay bàn giao.
- Với đơn kết hợp, tiền mặt được phân bổ theo thứ tự dòng rồi từng vé Social; phần còn lại là chuyển khoản. Báo cáo hiển thị số tiền từng khách theo quy tắc này. Đơn/giá/buổi và số tiền được lấy từ chứng từ, không suy ngược bằng giá catalog hiện tại.
- Cashier được xem/in/xuất báo cáo các ca mình phụ trách/tham gia; báo cáo toàn bộ vẫn chỉ Manager/Admin. Báo cáo đọc trong transaction snapshot để không bị lệch giữa tiền, kho và Social khi đang bán đồng thời.
- Nâng cấp schema bằng `npx tsx --env-file=.env.local scripts/prepare-ledgers.ts` (Preview) hoặc thay env-file tương ứng cho Production sau gate Preview. Lệnh chỉ chuẩn bị collection/index, không seed và không sửa dữ liệu kinh doanh. Trường mới tương thích dữ liệu cũ; không tạo bù lịch sử biến động hoặc ghi chú bàn giao vốn chưa được lưu trong bản cũ.

## Kiến trúc và dữ liệu

- `src/app/api/auth`: bcrypt, JWT HS256 12 giờ, cookie HttpOnly/Secure/SameSite Strict; kiểm tra Origin và giới hạn 10 lần đăng nhập/email/15 phút trong MongoDB.
- `src/app/api/workspace`: GET dữ liệu theo quyền; POST action được Zod validate và phân quyền tại service. User role/active luôn đọc lại từ MongoDB.
- `src/lib/service.ts`: nghiệp vụ dùng transaction replica set. Mọi thao tác bán/kiểm kê/đóng/bàn giao cùng ghi revision của ca, tránh race với chốt ca. Tồn kho giảm bằng điều kiện `remaining >= quantity`.
- Idempotency: unique `Sale.key`, fingerprint gồm nhân viên và payload. Retry cùng key trả cùng giao dịch; khác nội dung trả 409. Khi mất kết nối, POS giữ key trong phiên giao diện để gửi lại. **Không tải lại/đóng tab khi thanh toán đang chưa rõ kết quả**; sau khi tải lại phải kiểm tra Lịch sử giao dịch trước khi thu lại. Chưa có hàng đợi thanh toán tồn tại qua tải lại trang.
- `src/lib/models.ts`: User, Category, Product, Shift, Stock, Sale, Social, Audit, Attempt, Reversal, Movement. Seed tạo tất cả indexes trước khi nhận bán hàng. Lịch sử giao dịch giữ snapshot tên/giá, sản phẩm ngừng bán không bị xóa lịch sử. Stock cuối ca được snapshot trong Shift.
- Không cho sửa trực tiếp giao dịch hoặc ca đã chốt qua API. Audit được ghi cùng transaction với thay đổi quan trọng. Log lỗi API không ghi request body/credentials.
- Báo cáo CSV chống formula injection; ExcelJS ghi dữ liệu chuỗi, không nạp workbook do người dùng cung cấp. Override uuid lên bản vá tương thích API được smoke test bằng đọc lại workbook.

## Kiểm thử

```powershell
npm run typecheck
npm test
npm run build
npm run test:smoke
npm audit
```

Unit/integration dùng Node test runner + tsx; integration tạo MongoDB 7.0.14 replica set tạm bằng mongodb-memory-server. Lần đầu cần tải binary. Bộ test không load `.env.local`, không dùng Atlas. HTTP smoke khởi chạy Next production build trên cổng 3101 với database tạm, kiểm tra auth/CSRF/RBAC, POS, Social, hoàn/hủy và hoàn kho, JSON/CSV/XLSX theo ca, chốt ca và audit, rồi tắt server/xóa MongoDB tạm. Chạy smoke sau build. CI chạy typecheck, 30 tests, build và 17 HTTP smoke checks.

## Triển khai Vercel

1. Tạo project Next.js trong tài khoản/team được ủy quyền, liên kết repository. Không tự bật production từ nhánh chính trước khi Preview PASS.
2. Khai báo Environment Variables cho **Preview**: `MONGODB_URI` chứa tên database preview riêng, `SESSION_SECRET` ngẫu nhiên ít nhất 32 ký tự. Không đưa seed password lên Vercel. Bật system environment variables để có `VERCEL_URL`.
3. `APP_ORIGIN`: local đặt `http://localhost:3000`; Vercel Preview có thể bỏ trống và ứng dụng dùng `https://${VERCEL_URL}`. Dùng URL deployment chính xác khi kiểm thử, alias khác cần `APP_ORIGIN` tương ứng. Production đặt đúng origin HTTPS chính thức.
4. Seed catalog/admin có kiểm soát vào đúng database trước khi vận hành. Atlas database user chỉ cấp quyền database của ứng dụng. Cấu hình Atlas network access để Vercel kết nối; chọn networking phù hợp tài khoản/plan, không tự đổi access list của cluster dùng chung.
5. `vercel deploy --environment=preview` → kiểm tra đăng nhập, role, mở/thu/chốt ca **chỉ trên database kiểm thử**, mobile 390px, iPad 768/1024px, in và download. Vercel deployment protection có thể yêu cầu đăng nhập tài khoản được cấp quyền. Vercel CLI yêu cầu deployment đầu tiên của project mới mang nhãn Production: chỉ khi chủ dự án cho phép, dùng trang bảo trì tĩnh `deployment/bootstrap` để khởi tạo; không triển khai ứng dụng thu ngân trước khi Preview PASS.
6. Chỉ sau khi Preview và các gate đều PASS mới cấu hình database **Production riêng**, tạo tài khoản thật/catalog và deploy `vercel --prod`. Không chạy smoke/seed giao dịch giả trên Production. Không dùng cùng database Preview và Production.

Secrets chỉ nằm trong environment variables hoặc `.env.local`; `.env*`, `.vercel`, `.cache`, build artifacts đều được Git bỏ qua. Nếu credential bị lộ, chủ tài khoản cần rotate trước khi Production. Backup, retention/audit, giám sát lỗi và chính sách tài khoản phải được chủ sân cấu hình trước vận hành thực tế.

### Kiểm tra deployment thực

```powershell
# Vercel CLI đã đăng nhập, deployment ở trạng thái READY.
node --env-file=.env.local scripts/check-preview.mjs <IMMUTABLE_PREVIEW_URL>
# Chỉ database pickleball_cashier_preview: tạo fixture QA có tên riêng,
# kiểm tra Atlas đồng thời/thu/chốt ca, rồi xóa đúng fixture đó trong transaction.
node --env-file=.env.local scripts/check-preview-workflow.mjs <IMMUTABLE_PREVIEW_URL>
```

Script đọc secrets từ environment, truyền mật khẩu/cookie qua stdin cho Vercel curl; không in secrets. Workflow từ chối chạy nếu URI không phải database Preview chuyên biệt hoặc Preview đã có ca trước đó. Kết quả QA được ghi lại bằng audit `preview.qa.completed`. Không dùng script workflow trên Production.

`scripts/configure-production.mjs` chỉ tạo `.env.production.local` bị Git bỏ qua, với database Production riêng, SESSION_SECRET và mật khẩu Admin mới; không kết nối MongoDB. Chỉ seed catalog/admin và đưa secrets lên Vercel Production sau khi Preview PASS. Sau deploy, kiểm tra chỉ đọc:

```powershell
node --env-file=.env.production.local scripts/check-preview.mjs https://pickleball-cashier.vercel.app --production-readonly
```

Đọc email/mật khẩu Production trong `.env.production.local` trên máy, không đăng lên Git/chat. Tài khoản Preview và Production có mật khẩu khác nhau. Phiên bản Node được cố định `24.x` cho local, CI và Vercel.

## Tài liệu nền tảng

[Next.js authentication](https://nextjs.org/docs/app/guides/authentication) · [Mongoose transactions](https://mongoosejs.com/docs/transactions.html)
