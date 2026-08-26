# Contributing to WattWise

`main` คือ branch ที่ควรพร้อมใช้งานเสมอ งานทุกชิ้นให้เริ่มจาก `main` ที่อัปเดตแล้วบน branch สั้น ๆ ชื่อ `codex/<topic>` และส่งผ่าน Pull Request ห้าม force-push หรือ commit ตรงเข้า `main`

## Workflow

```powershell
git switch main
git pull --ff-only
git switch -c codex/<topic>
```

ก่อนเปิด Pull Request ให้ติดตั้ง dependency จาก lockfile และรัน checks เดียวกับ CI:

```powershell
npm ci
npm test
npm run lint
npm run build
```

Pull Request ควรมีขอบเขตเล็ก อธิบายสิ่งที่เปลี่ยนและผลการตรวจสอบให้ชัดเจน เมื่อ CI ผ่านแล้วให้ squash merge เพื่อให้ประวัติบน `main` อ่านง่าย

อย่า commit โฟลเดอร์หรือ state ที่สร้างในเครื่อง เช่น `node_modules`, `dist`, `.next`, `.vinext`, `.wrangler` หรือฐานข้อมูล SQLite ภายใน `.wrangler` การเปลี่ยน migration, `package-lock.json` และ `.openai/hosting.json` ต้องตรวจสอบเป็นพิเศษก่อน merge

ชุดทดสอบปัจจุบันครอบคลุมเฉพาะ calculation engine ที่เป็น pure functions ควรเพิ่ม regression test เมื่อแก้สูตรคำนวณ และขยาย integration tests เมื่อ persistence กับ tariff มีความเสถียรมากขึ้น
