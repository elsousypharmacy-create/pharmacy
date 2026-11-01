# تقرير الكاميرات اليومي — تعليمات المراجعة

This file is the full recipe for the scheduled camera report (runs three times a day). It does not change any code.
Write all report text in short Egyptian Arabic. Be strict: report every problem you can clearly see.

## Window
- Drive root «كاميرات الصيدلية» id `1nxoCmGnDiwdFktz4QmoU56Uj4tfBRtEk`, day folders `yyyy-MM-dd` (Cairo time).
- Frames: `HHmm_chN.jpg`, 960×576, cameras 1, 2, 3, 4, 6 (no 5). Ignore `_s.jpg` copies.
- **من 8 ص إلى 12 ظ:** today's folder, 0800 <= HHmm < 1200; report date today, file time 1200. Target around 12:10 Cairo.
- **من 12 ظ إلى 6 م:** today's folder, 1200 <= HHmm < 1800; report date today, file time 1800. Target around 18:10 Cairo.
- **من 6 م إلى 1 ص:** yesterday's folder HHmm >= 1800 PLUS today's folder HHmm < 0100; report/business date yesterday, file time 2359 for existing dashboard ordering. Target around 01:10 Cairo. Clearly display both dates in range/note and actual windowEnd; no midnight frames in the noon report.
- The report label and visible title MUST be the covered period itself, not «الضهر/الليل». Record generatedAt, windowStart, windowEnd as actual ISO timestamps with Africa/Cairo offsets. Put preparation date/time visibly in note too.
- Camera names: 1 = الرصيف (برة), 2 = الرفوف, 3 = المكتب والكاونتر, 4 = الواجهة الزجاج, 6 = الرصيف (برة).

## 1. List frames (no download yet)
Drive `search_files`: `parentId = '<day folder id>'` with `excludeContentSnippets: true`, page through all results. Keep `title`, `id`, `fileSize`.
If there are no frames in the window: save a report with `"summary":[]`, `"pages":[]` and
`"note":"مفيش لقطات في الفترة دي — اتأكد إن السحب التلقائي شغال"`, then stop.

## 2. Pick frames to look at
- Cameras 2, 3, 4: the frame closest to each full hour.
- Cameras 1, 6: one frame every 3 hours.
- Plus "activity" frames: per camera, frames whose fileSize is clearly above that camera's median (≈ +12% or more): more people or clutter. Up to 8 extra.

## 3. Download and look
- `download_file_content(fileId)`. The result is saved to a file: decode with `jq -r .content <file> | base64 -d > x.jpg`
  and check the byte size equals `fileSize`. Never judge a partial image.
- Small files (under ~45 KB, e.g. dark night frames) come back inline instead of saved to a file. Do not paste them; pick a neighbouring
  frame of the same camera instead, or list the camera in `note` as «ماتشافتش».
- Use Python PIL to build grids (3×3 of half-size frames, time + camera written on each) and view the grids first.
- Then crop and zoom (2×) every area that matters: desk, counter tops, shelves, drawers/doors, floor, diapers and milk shelves, outside steps.

## 4. Checklist (strict)
- Money visible anywhere (desk, counter). Keys, phones, drinks, papers on the desk.
- Someone sitting at the doctor's desk / on a phone while a customer waits. Customer waiting unserved.
- Clothing/uniform is low priority and excluded from the appearance score; do not raise it as a standalone top alert.
- Bags / orders left on the display counter. Boxes or items left on counter tops, not on their shelf.
- Drawers pulled out, cabinet doors open.
- Shelf facing (الرص): gaps, items lying down, items not facing front, uneven rows.
- Diapers: gaps, packs not aligned. Milk: half-empty shelf, cans stacked randomly, boxes tilted.
- Floor: bags, cartons, trash. Broken/torn furniture (stools, chairs).
- Lights off. Outside: rubble, trash, people blocking the entrance, steps dirty.
People: describe neutrally, no names.
- Clutter on any counter top or around the computer (boxes, cables, products not in place). Items stored on top of shelves.
- Equipment left on after closing (screens, lights). Dirty camera lens (streaks/haze in the image).
Strict rule: zoom EVERY area of EVERY frame you use before writing. Anything out of place gets an arrow, even small.
If an area cannot be judged (dark/IR night image, blur), say so in `note` (e.g. «رص كاميرا 2 ماتقيّمش») — never treat it as OK.

## Appearance score and previous-report comparison
Read and follow `tools/camera-appearance-kpi.md`. Before judging, read the previous period's report and evidence; preserve stable problem IDs. Add the ten evidence-backed checks and issue states there to JSON v2. Do not fabricate ratings for legacy reports. Never close a previous issue from an absent or obscured camera view. Keep actual image sampling bounded; this does not enable -next or change capture.

## 5. Group and build pages
- Group the same problem across times (same thing, same place). Count it and list its times (HH:MM, 12-hour, Latin digits).
- One page = one frame. Put on it every problem visible in that frame (max 8 numbered labels).
  Choose frames so that EVERY problem in the summary appears on at least one page.
- `repeats` on a page = other frames where the page's main problem also shows: `crop` = [x, y, w, h] around it in 960×576, keep 4:3 (e.g. 320×240).
- Label text `now` = the problem only, ≤ 4 words (no «المفروض»). Labels are drawn as white pills ≈ (11 px × characters + 60) wide, 42 px tall in 960 space.
  `to` = exact point of the problem. `lab` = pill centre on an empty area (floor, wall, ceiling), inside the image, not covering the problem or another pill.
- Summary: `sev` "r" = money/people/customer problems, "y" = order/cleanliness/stock problems. Order: r first.

## 6. JSON (one line)
```json
{"v":2,"date":"2026-11-01","time":"1200","label":"من 8 ص إلى 12 ظ","dayLabel":"الأحد 1 نوفمبر","range":"من 8 ص إلى 12 ظ","by":"Claude","space":[960,576],
 "note":"اتراجعت 28 لقطة",
 "summary":[{"text":"فلوس ظاهرة على المكتب","where":"ك3","times":["9:10","10:00","11:20"],"count":"3 مرات","sev":"r"}],
 "pages":[{"ch":3,"name":"المكتب والكاونتر","title":"فلوس على المكتب","file":"<Drive id of the frame>","label":"11:20 ص",
   "items":[{"now":"فلوس على المكتب","lab":[735,120],"to":[540,410]}],
   "repeats":[{"file":"<id>","label":"9:10 ص","crop":[380,250,320,240]}]}]}
```

## 7. Save
Drive `create_file`: parentId `1vZymfwoNtW4JhIKCkpLXL20JWodmpDu4` («تقارير»), title `report_<date>_<time>.json`
(`<date>` = the day folder's date), contentMimeType `application/json`, disableConversionToGoogleType true, textContent = the JSON.
If the title exists, add `_2`. Do not send Telegram/WhatsApp, do not change code, do not commit.
End with 3 short lines: window, number of problems, top 3.

