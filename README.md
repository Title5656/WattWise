# WattWise

Home Energy Builder & Simulator สำหรับประกอบบ้านจำลองจากเครื่องใช้ไฟฟ้าและประมาณการใช้พลังงาน

## Current prototype

- Catalog ที่ใช้งานอยู่ 374 รุ่น: EGAT Label No.5 ที่คัดสรร 361 รุ่น และรุ่น legacy 13 รุ่นเพื่อความเข้ากันได้ของข้อมูลบ้านที่บันทึกไว้
- Search และ filter ตามหมวดหมู่
- Drag-and-drop หรือกดเพิ่มอุปกรณ์เข้าบ้าน
- ปรับจำนวนและชั่วโมงใช้งาน
- คำนวณ kWh/เดือนตาม usage profile ของอุปกรณ์และค่าไฟตาม tariff บ้านอยู่อาศัย
- บันทึกรายการอุปกรณ์ในบ้านลง D1/SQLite แบบอัตโนมัติเมื่อมี database binding
- โครง D1/SQLite สำหรับ Catalog, Household และ Tariff

> ค่า usage profile เป็นค่าประมาณมาตรฐานตามชนิดอุปกรณ์ ไม่ใช่ข้อมูลรับรองเฉพาะรุ่น ส่วน tariff บ้านอยู่อาศัยอ้างอิงตามช่วงวันที่ของประกาศทางการ

## Project documents

- `PROJECT_SPEC.md` — ขอบเขตผลิตภัณฑ์และ acceptance criteria
- `CONTRIBUTING.md` — วิธีพัฒนา ตรวจสอบ และส่ง Pull Request
- `docs/catalog.md` — EGAT snapshot provenance, D1 migration procedure, and catalog API contract
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

นี่คือ first product slice สำหรับทดสอบทิศทาง UX หน้า Home Builder บันทึกรายการอุปกรณ์ลง D1/SQLite ได้แล้ว โดยการคำนวณใช้แกนกลางร่วมกันระหว่างหน้าและ API พร้อม tariff registry ตามช่วงวันที่ ส่วนฟีเจอร์ Scenario และ load profile แบบละเอียดอยู่ใน milestone ถัดไป
