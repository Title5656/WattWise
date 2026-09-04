# WattWise

Home Energy Builder & Simulator สำหรับประกอบบ้านจำลองจากเครื่องใช้ไฟฟ้าและประมาณการใช้พลังงาน

## Current application

- Catalog ที่ใช้งานอยู่ 374 รุ่น: EGAT Label No.5 ที่คัดสรร 361 รุ่น และรุ่น legacy 13 รุ่นเพื่อความเข้ากันได้ของข้อมูลบ้านที่บันทึกไว้
- Search และ filter ตามหมวดหมู่
- Drag-and-drop หรือกดเพิ่มอุปกรณ์เข้าบ้าน
- ปรับจำนวนและชั่วโมงใช้งาน
- คำนวณ kWh/เดือนตาม usage profile ของอุปกรณ์และค่าไฟตาม tariff บ้านอยู่อาศัย
- บัญชีผู้ใช้และสมาชิกบ้านแบบหลายต่อหลาย พร้อม role `owner`, `admin`, `member`, `viewer`
- เลือกและจัดการหลาย Household โดยข้อมูลบ้าน อุปกรณ์ บิล และประวัติถูกแยกตาม Household
- บันทึกรายการอุปกรณ์ลง D1/SQLite แบบ autosave ที่แยก draft ตาม user และ Household พร้อม optimistic concurrency
- Catalog และ tariff reference data เป็นข้อมูลกลางที่ทุก Household ใช้ร่วมกัน

> ค่า usage profile เป็นค่าประมาณมาตรฐานตามชนิดอุปกรณ์ ไม่ใช่ข้อมูลรับรองเฉพาะรุ่น ส่วน tariff บ้านอยู่อาศัยอ้างอิงตามช่วงวันที่ของประกาศทางการ

## Project documents

- `PROJECT_SPEC.md` — ขอบเขตผลิตภัณฑ์และ acceptance criteria
- `CONTRIBUTING.md` — วิธีพัฒนา ตรวจสอบ และส่ง Pull Request
- `docs/catalog.md` — EGAT snapshot provenance, D1 migration procedure, and catalog API contract
- `docs/multi-user-cutover.md` — ขั้นตอน read-only cutover, quarantine verification และ explicit claim
- `db/schema.ts` — แบบข้อมูล D1/SQLite
- `lib/energy.ts` — Calculation engine แบบ pure functions

## Run on Windows

```powershell
.\scripts\dev.ps1
```

สร้าง production build ด้วย:

```powershell
.\scripts\build.ps1
```

สคริปต์ทั้งสองรองรับชื่อโฟลเดอร์ที่มีเครื่องหมาย `&`

## Status

ระบบใช้ Household เป็น ownership boundary แยกจาก User แล้ว หน้า Dashboard และ My Home อ้าง Household ผ่าน URL ที่ชัดเจนและทุก API ตรวจ session, membership และ role ฝั่ง server ข้อมูลจาก prototype เดิมจะอยู่ใน quarantine จนกว่าจะผ่านการตรวจและถูก claim ด้วย token แบบใช้ครั้งเดียว
