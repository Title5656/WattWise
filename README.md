# WattWise

Home Energy Builder & Simulator สำหรับประกอบบ้านจำลองจากเครื่องใช้ไฟฟ้าและประเมินการใช้พลังงาน

## Current prototype

- Catalog ตัวอย่าง 6 รุ่น
- Search และ filter ตามหมวดหมู่
- Drag-and-drop หรือกดเพิ่มอุปกรณ์เข้าบ้าน
- ปรับจำนวนและชั่วโมงใช้งาน
- คำนวณ kWh/เดือนและค่าไฟตัวอย่างทันที
- โครง D1/SQLite สำหรับ Catalog, Household และ Tariff

> ข้อมูลรุ่นและอัตราค่าไฟในหน้าต้นแบบเป็นข้อมูลสาธิต ยังไม่ใช่ชุดข้อมูลที่ตรวจสอบสำหรับใช้อ้างอิงจริง

## Project documents

- `PROJECT_SPEC.md` — ขอบเขตผลิตภัณฑ์และ acceptance criteria
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

นี่คือ first product slice สำหรับทดสอบทิศทาง UX ยังไม่มีการบันทึกข้อมูลจากหน้าเว็บลงฐานข้อมูล
