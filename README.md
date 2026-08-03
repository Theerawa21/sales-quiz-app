# แบบทดสอบออนไลน์ - การขายสำหรับนักธุรกิจมืออาชีพ

ระบบทดสอบออนไลน์ (Google Apps Script + Google Sheets เป็นฐานข้อมูล/แบ็กเอนด์, หน้าเว็บสำหรับนักเรียนโฮสต์บน GitHub Pages)

## โครงสร้างไฟล์
- `Code.gs` — วางในโปรเจกต์ Apps Script ที่ผูกกับ Google Sheet (Extensions > Apps Script) มีทั้งตรรกะระบบสอบและ JSON API
- `Index.html` — ไฟล์ HTML สำหรับ Apps Script editor (ใช้ `google.script.run`) เปิดผ่านลิงก์ Web App ของ Apps Script ได้โดยตรง
- `docs/index.html` — หน้าเว็บสำหรับนักเรียน โฮสต์แยกบน GitHub Pages เรียกข้อมูลผ่าน `fetch()` ไปยัง Apps Script Web App

## วิธีติดตั้ง

### 1) ฝั่ง Google Apps Script (แบ็กเอนด์ + ฐานข้อมูล)
1. เปิด Google Sheet ที่ใช้เก็บข้อสอบ/รายชื่อ/คะแนน → เมนู Extensions > Apps Script
2. วางเนื้อหาไฟล์ `Code.gs` และ `Index.html` ในโปรเจกต์ (ไฟล์ HTML ต้องตั้งชื่อ `Index`)
3. รันเมนู "ระบบทดสอบออนไลน์ > ตั้งค่าระบบ (Setup)" บน Sheet เพื่อสร้างชีท Questions/Students/Responses/สรุปคะแนน/Settings
4. Deploy > New deployment > เลือก "Web app" ตั้งค่า Execute as: Me, Who has access: Anyone with the link แล้ว Deploy คัดลอกลิงก์ที่ลงท้ายด้วย `/exec`

### ส่วนของครู (แผงควบคุมในหน้าเว็บ)
- ลิงก์ "สำหรับครูผู้สอน" อยู่ท้ายหน้าเว็บ (ทั้งฉบับ Apps Script และ GitHub Pages) กรอกรหัสเข้าใช้งานเพื่อเปิดแผงควบคุม
- รหัสเข้าใช้งานเริ่มต้นคือ `211238` เก็บอยู่ที่ชีท `Settings!B2` — เปลี่ยนรหัสได้โดยแก้ค่าตรงเซลล์นั้น ไม่ต้องแก้โค้ด
- ปุ่มเปิด/ปิดสอบในแผงควบคุม จะเขียนสถานะลง `Settings!B1` (เปิด/ปิด) — จะสั่งเปิด/ปิดจากเมนู "ระบบทดสอบออนไลน์ > เปิดสอบ/ปิดสอบ" บน Google Sheet โดยตรงก็ได้เช่นกัน เมื่อปิดสอบ นักเรียนที่ยังไม่เริ่มจะเข้าทำไม่ได้ แต่คนที่ทำค้างอยู่ยังส่งคำตอบได้ตามปกติ
- แผงควบคุมแสดงสรุปจำนวนผู้เข้าสอบ คะแนนเฉลี่ย จำนวนผู้ผ่านเกณฑ์ และตารางรายชื่อผู้ส่งคำตอบแล้วทั้งหมด (ข้อมูลเดียวกับชีท Responses) กดรีเฟรชเพื่อดึงข้อมูลล่าสุด

### 2) ฝั่งหน้าเว็บ (GitHub Pages)
1. เปิดไฟล์ `docs/index.html`
2. แก้บรรทัด `var APPS_SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';` ให้เป็นลิงก์ `/exec` จากขั้นตอนก่อนหน้า
3. Commit + push ขึ้น GitHub แล้วเปิดใช้งาน GitHub Pages: Settings > Pages > Source: Deploy from a branch > Branch: `main` / Folder: `/docs`
4. รอสักครู่ ลิงก์เว็บสำหรับนักเรียนจะอยู่ที่ `https://<username>.github.io/<repo>/`

ทุกครั้งที่แก้ `Code.gs` ต้อง Deploy > Manage deployments > New version เพื่ออัปเดตลิงก์เดิม (ลิงก์ `/exec` จะไม่เปลี่ยน)
