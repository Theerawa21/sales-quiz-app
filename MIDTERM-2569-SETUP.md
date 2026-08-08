# ระบบสอบกลางภาคเรียนที่ 1 ปีการศึกษา 2569

รายวิชา **การขายสำหรับนักธุรกิจมืออาชีพ**  
ชั้น **ม.4/3, ม.4/4, ม.4/5**

## สถาปัตยกรรม

- Frontend: GitHub Pages (`docs/midterm-2569.html`)
- Backend/API: Google Apps Script (`apps-script/Code2569.gs`)
- Database: Google Sheet ID `1ihwm5kmIFcYNOm_QvyMqsyn-fp8dYDWNCm5AM5k9ksE`

## Google Sheet

ใช้ไฟล์:
https://docs.google.com/spreadsheets/d/1ihwm5kmIFcYNOm_QvyMqsyn-fp8dYDWNCm5AM5k9ksE/edit

แท็บฐานข้อมูล:
- `SETTINGS`
- `STUDENTS`
- `QUESTIONS`
- `SESSIONS`
- `RESPONSES`
- `AUDIT`

## ขั้นตอนเชื่อม Apps Script

1. เปิด Google Sheet ข้างต้น
2. Extensions > Apps Script
3. สร้างไฟล์สคริปต์ หรือแทนที่ Code.gs ด้วยเนื้อหาใน `apps-script/Code2569.gs`
4. Save
5. Deploy > New deployment
6. Type: Web app
7. Execute as: Me
8. Who has access: Anyone
9. Deploy แล้วคัดลอก URL ที่ลงท้าย `/exec`

## เชื่อม GitHub Pages

เปิด `docs/midterm-2569.html` และแก้

```js
var API='PASTE_APPS_SCRIPT_EXEC_URL_HERE';
```

เป็น URL `/exec` ที่ได้จาก Apps Script แล้ว Commit

## เปิด GitHub Pages

Repository Settings > Pages

- Source: Deploy from a branch
- Branch: `master`
- Folder: `/docs`

หน้าเว็บสอบจะอยู่ประมาณ:

`https://theerawa21.github.io/sales-quiz-app/midterm-2569.html`

## การตั้งค่าหลัก

แก้ในชีต `SETTINGS`

- `EXAM_OPEN` เปิด/ปิดสอบ
- `EXAM_CODE` รหัสเข้าห้องสอบ
- `ADMIN_PIN` PIN ครู
- `DURATION_MIN` เวลา 40 นาที
- `QUESTION_COUNT` 40 ข้อ
- `MAX_TAB_SWITCH` 3 ครั้ง
- `ONE_ATTEMPT` TRUE
- `SHOW_SCORE` FALSE
- `START_TIME`, `END_TIME` กำหนดช่วงเวลาสอบได้

## ป้องกันการทุจริต

- ตรวจรหัสนักเรียนและห้อง
- รหัสเข้าห้องสอบ
- จำกัด 1 คน 1 ครั้ง
- สุ่มข้อสอบ
- สุ่มตัวเลือก
- แสดงทีละข้อและไม่ย้อนกลับ
- จับเวลา server-side
- Auto-submit เมื่อหมดเวลา
- ตรวจสลับแอป/ซ่อนหน้าเว็บ
- Auto-submit เมื่อผิดเงื่อนไขครบจำนวน
- ปิด copy/cut/paste/context menu
- บันทึก `AUDIT` สำหรับตรวจสอบเหตุการณ์

> ระบบเว็บช่วยลดโอกาสทุจริต แต่ไม่สามารถป้องกันการใช้อุปกรณ์เครื่องที่สองได้ 100% ควรใช้ร่วมกับการคุมสอบในห้องจริง
