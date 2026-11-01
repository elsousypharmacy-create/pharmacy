---
name: "elsousy-camera-report"
description: "Use when Ahmed asks for a camera report (تقرير الكاميرات / جهّز التقرير / تقرير اليوم) for صيدلية د. أحمد السوسي. Reads Drive camera frames, reviews them strictly, and saves a JSON report so it shows in the dashboard (الفلوس ← التقارير)."
---

# تقرير كاميرات صيدلية السوسي

Talk to Ahmed in short Egyptian Arabic. Never ask for passwords/tokens. Never put secrets in the repo.

The report is a small JSON file saved to Google Drive. The dashboard (index.html → التقارير) draws the numbered labels and arrows on the real frames and makes the PDF. You do NOT draw images: you look at frames and write the JSON.

## Source of truth
The full, current recipe is in the repo `elsousypharmacy-create/pharmacy`, file `tools/camera-day-report.md` (read it from the checkout, or with the GitHub tool `get_file_contents`). Follow it exactly. It covers: time windows, which frames to review, grids, zoom rules, the checklist, the JSON format (v2) and where to save. If this skill, the recipe, or a task prompt differ, the recipe wins.

## The rules that matter most
1. **Window:** noon report = today's frames before 12:00. Midnight run = yesterday's frames from 12:00, split in TWO reports (12:00–17:59 «تقرير العصر» time 1800, 18:00–23:59 «تقرير الليل» time 2359). Work one hour at a time.
2. **Sampling:** inside cameras 2, 3, 4 → every frame (every 10 min). Outside cameras 1 and 6 → one frame every 30 min, alternating. Use hourly zip bundles when they exist in the day folder; otherwise download frames one by one (prefer `_s.jpg` copies, they arrive complete).
3. **Grids are for screening only:** 4×3 grids, tiles 400×240, labelled with time + camera, grouped by camera. **Never judge a small item (phone, keys, money, bag, shelf gaps) from a grid.** Open the original, crop, zoom 2×, then decide.
4. **If an area cannot be judged, say so** in `note` (e.g. «رص كاميرا 2 ماتقيّمش»). Never write OK from a grid alone.
5. **Be strict:** every out-of-place item gets a numbered label with an arrow. Describe people neutrally, no names.
6. **Never** send Telegram/WhatsApp messages, change code, or commit from a report run. Don't paste partial images: a partial original → use its `_s.jpg`.

## Where things are (Google Drive, Cairo time UTC+2)
- Camera frames: root folder «كاميرات الصيدلية» id `1nxoCmGnDiwdFktz4QmoU56Uj4tfBRtEk`, day folders `yyyy-MM-dd`, files `HHmm_chN.jpg` (960×576) and `HHmm_chN_s.jpg` (640 wide). Cameras: 1, 2, 3, 4, 6 (no 5).
- Reports are saved to the folder «تقارير» id `1vZymfwoNtW4JhIKCkpLXL20JWodmpDu4` as `report_<date>_<time>.json`.
- Camera names: 1 = الرصيف (برة), 2 = الرفوف, 3 = المكتب والكاونتر, 4 = الواجهة الزجاج, 6 = الرصيف (برة).

## Reply
End with 3 short Egyptian-Arabic lines: the window covered, number of problems, the top 3.
