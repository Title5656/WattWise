# Header and Sidebar Utility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้ปุ่ม “บ้านวิทวัส” จัดแนวและมีขนาดพอดีกับปุ่มกระดิ่ง พร้อมเปลี่ยน account card ท้าย sidebar ให้เป็นสถานะบ้านที่กดไปจัดการ My Home ได้จริง

**Architecture:** คงโครงสร้าง dashboard และข้อมูลเดิมทั้งหมด โดยเพิ่ม `homeItemCount` เป็น optional prop ให้ `WattWiseSidebar` และส่งค่าจาก state ที่แต่ละหน้ามีอยู่แล้ว จากนั้นเปลี่ยน account card เป็น `Link` ไป `/my-home` และเพิ่ม CSS override เฉพาะ control สองจุดเพื่อเลี่ยงการรื้อ stylesheet เดิม

**Tech Stack:** React 19, TypeScript, Vinext/Next-compatible routing, Lucide React, CSS, Node test runner

**Spec:** In-chat bounded design approved by the user on 2026-08-28; no separate spec file

## Global Constraints

- ไม่เพิ่ม dependency, API route หรือ client-side fetch ใหม่
- คงชื่อ “บ้านวิทวัส” ไว้ใน header และไม่แสดงชื่อผู้ใช้ซ้ำที่ท้าย sidebar
- interactive control ต้องมี touch target อย่างน้อย 44×44px
- ต้องใช้งานได้ทั้ง sidebar แบบหุบ, hover/focus-expanded และ mobile drawer
- ใช้ Lucide icon ที่ติดตั้งอยู่แล้ว ห้ามใช้อักขระแทนไอคอน

---

### Task 1: Add regression coverage for the shell controls

**Files:**
- Create: `tests/header-sidebar-ui.test.mjs`

**Interfaces:**
- Consumes: source files `app/page.tsx`, `app/my-home/page.tsx`, `app/components/WattWiseSidebar.tsx`, and `app/globals.css`
- Produces: regression assertions for the sidebar destination/copy/count prop and the 44px header-control sizing contract

- [ ] **Step 1: Write the failing source-level regression test**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function latestRule(styles, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [...styles.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  return rules.at(-1)?.[1] ?? '';
}

test('header profile and notification controls share the same 44px height', async () => {
  const styles = await readProjectFile('app/globals.css');

  assert.match(latestRule(styles, '.notify'), /height:\s*44px/);
  assert.match(latestRule(styles, '.header-actions>.profile'), /height:\s*44px/);
  assert.match(latestRule(styles, '.header-actions>.profile'), /min-height:\s*44px/);
  assert.match(latestRule(styles, '.profile>i'), /width:\s*32px/);
  assert.match(latestRule(styles, '.profile>i'), /height:\s*32px/);
});

test('sidebar footer is a useful My Home status link', async () => {
  const [dashboard, myHome, sidebar] = await Promise.all([
    readProjectFile('app/page.tsx'),
    readProjectFile('app/my-home/page.tsx'),
    readProjectFile('app/components/WattWiseSidebar.tsx'),
  ]);

  assert.match(sidebar, /homeItemCount\?: number/);
  assert.match(sidebar, /className="sidebar-account"/);
  assert.match(sidebar, /href="\/my-home"/);
  assert.match(sidebar, /aria-label="ไปจัดการอุปกรณ์ใน My Home"/);
  assert.match(sidebar, /อุปกรณ์ · ออนไลน์/);
  assert.doesNotMatch(sidebar, /เปิดโปรไฟล์|<i>WP<\/i>/);
  assert.match(dashboard, /homeItemCount=\{homeLoading \? undefined : homeItems\.length\}/);
  assert.match(myHome, /homeItemCount=\{saveState === 'loading' \? undefined : homeItems\.length\}/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing behavior**

Run: `node --test tests/header-sidebar-ui.test.mjs`

Expected: FAIL because `.profile` still computes from the default 36px button height and `WattWiseSidebar` does not yet accept `homeItemCount` or link to `/my-home`.

- [ ] **Step 3: Commit the failing regression test**

```bash
git add tests/header-sidebar-ui.test.mjs
git commit -m "test: cover header and sidebar utility controls"
```

---

### Task 2: Turn the sidebar footer into My Home status

**Files:**
- Modify: `app/components/WattWiseSidebar.tsx`
- Modify: `app/page.tsx`
- Modify: `app/my-home/page.tsx`

**Interfaces:**
- Consumes: `homeItems.length`, `homeLoading` on the dashboard, and `saveState` on My Home
- Produces: `WattWiseSidebar({ active, homeItemCount }: { active: ActivePage; homeItemCount?: number })`

- [ ] **Step 1: Extend the sidebar props and replace the inert account card**

Change the component signature and footer to this shape, reusing the already imported `House` and `ChevronRight` icons:

```tsx
export function WattWiseSidebar({
  active,
  homeItemCount,
}: {
  active: ActivePage;
  homeItemCount?: number;
}) {
```

Replace only the current `<div className="sidebar-account" ...>` footer with:

```tsx
<Link
  className="sidebar-account"
  href="/my-home"
  onClick={() => setOpen(false)}
  aria-label="ไปจัดการอุปกรณ์ใน My Home"
>
  <i className="sidebar-home-icon"><House aria-hidden="true" /><span /></i>
  <span>
    <b>สถานะบ้าน</b>
    <small>{homeItemCount === undefined ? 'กำลังเชื่อมข้อมูลบ้าน' : `${homeItemCount} อุปกรณ์ · ออนไลน์`}</small>
  </span>
  <ChevronRight aria-hidden="true" />
</Link>
```

Remove the nested ghost `Button`, the duplicated “วิทวัส / บ้านของฉัน” copy, and the `WP` badge from the sidebar footer only. Keep the `WP` avatar inside the top-right “บ้านวิทวัส” control.

- [ ] **Step 2: Pass the existing home count from both call sites**

Dashboard:

```tsx
<WattWiseSidebar
  active="status"
  homeItemCount={homeLoading ? undefined : homeItems.length}
/>
```

My Home:

```tsx
<WattWiseSidebar
  active="home"
  homeItemCount={saveState === 'loading' ? undefined : homeItems.length}
/>
```

- [ ] **Step 3: Run the focused source test**

Run: `node --test tests/header-sidebar-ui.test.mjs`

Expected: the sidebar-status test passes; the sizing test remains failing until Task 3.

- [ ] **Step 4: Commit the functional sidebar change**

```bash
git add app/components/WattWiseSidebar.tsx app/page.tsx app/my-home/page.tsx tests/header-sidebar-ui.test.mjs
git commit -m "feat: make sidebar home status actionable"
```

---

### Task 3: Normalize control sizing and responsive presentation

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: existing `.header-actions`, `.notify`, `.profile`, `.sidebar-account`, and sidebar expansion breakpoints
- Produces: a 44px shared header-control height and collapsed/expanded/mobile styles for the new status link

- [ ] **Step 1: Add a focused final override for the header controls**

Place this after the existing touch-target rules so it wins over the default `Button` height utility without `!important`:

```css
.header-actions>.profile {
  height:44px;
  min-height:44px;
  padding:5px 10px 5px 6px;
}
.profile>i {
  width:32px;
  height:32px;
  flex:0 0 32px;
}
.profile span {
  min-width:0;
  justify-content:center;
  line-height:1.2;
}
```

- [ ] **Step 2: Style the sidebar status link for all navigation states**

Replace button-specific footer rules with icon/link rules and retain the existing 254px expanded width:

```css
.sidebar-account {
  color:#20332a;
  text-decoration:none;
}
.sidebar-home-icon {
  position:relative;
}
.sidebar-home-icon svg {
  width:18px;
  height:18px;
}
.sidebar-home-icon>span {
  position:absolute;
  right:3px;
  bottom:3px;
  width:7px;
  height:7px;
  border:2px solid #1b3b2a;
  border-radius:50%;
  background:#d5f671;
}
.sidebar-account>svg {
  width:18px;
  height:18px;
  color:#66756d;
  opacity:0;
  transition:opacity .18s;
}
.sidebar:hover .sidebar-account>svg,
.sidebar:focus-within .sidebar-account>svg {
  opacity:1;
}
.sidebar-account:hover,
.sidebar-account:focus-visible {
  border-color:#8ab82640;
  background:#f7ffe6;
  outline:none;
}
.sidebar-account:focus-visible {
  box-shadow:0 0 0 2px #86b91b55;
}
@media(max-width:700px) {
  .sidebar-account>svg {
    display:block!important;
    opacity:1!important;
  }
}
```

In the existing mobile reveal selector, replace `.sidebar-account button` with `.sidebar-account>svg`. Keep the existing `.sidebar-account{display:grid;width:auto;min-width:0}` mobile rule so the link fills the drawer. The existing `.sidebar{overflow:hidden}` rule keeps the collapsed desktop sidebar from scrolling horizontally.

- [ ] **Step 3: Run the focused and full automated checks**

Run:

```bash
node --test tests/header-sidebar-ui.test.mjs
npm test
npm run check:icons
npm run build
```

Expected: all commands exit 0; no symbol-based icon violations; production build completes.

- [ ] **Step 4: Verify the rendered layout at representative breakpoints**

Start the local app with `npm run dev` and inspect:

- Desktop 1280×720: `.notify` and `.profile` both render at 44px height and share the same vertical center.
- Collapsed sidebar: only the home/status icon is visible at the bottom; no `WP` account badge remains.
- Expanded sidebar: copy reads “สถานะบ้าน” plus either loading text or “N อุปกรณ์ · ออนไลน์”; the entire card is clickable.
- Mobile ≤700px: drawer footer is fully visible, tapping it navigates to `/my-home`, and the drawer closes.
- Keyboard: Tab focus reveals the expanded sidebar copy, shows a visible focus ring, and Enter activates `/my-home`.

- [ ] **Step 5: Commit the sizing and responsive styling**

```bash
git add app/globals.css tests/header-sidebar-ui.test.mjs
git commit -m "fix: align header controls and sidebar status"
```
