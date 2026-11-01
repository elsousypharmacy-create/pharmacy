# تقرير الكاميرات اليومي — النسخة الجديدة (جاهزة، مش مفعّلة لسه)

> **NOT ACTIVE.** The scheduled tasks read `tools/camera-day-report.md`. Ahmed decided to keep the current tasks/settings until his usage renews. To activate this design later: copy this file over `camera-day-report.md` (it makes the midnight run produce two reports and reviews many more frames, so it uses more).

This file is the full recipe for the scheduled camera report (the noon run makes one report, the midnight run makes two). It does not change any code.
Write all report text in short Egyptian Arabic. Be strict: report every problem you can clearly see.

## Window and reports
**This section overrides the task prompt (once activated):** if the prompt names a single label/file time for the midnight run, still make the two reports below.
- Drive root «كاميرات الصيدلية» id `1nxoCmGnDiwdFktz4QmoU56Uj4tfBRtEk`, day folders `yyyy-MM-dd` (Cairo time).
- Frames: `HHmm_chN.jpg` (original 960×576) and `HHmm_chN_s.jpg` (640 wide copy made from the Drive thumbnail). Cameras 1, 2, 3, 4, 6 (no 5).
- **Noon run (12:04 Cairo):** today's folder, frames with HHmm < 1200. ONE report: `label` «تقرير الضهر», file time `1200`.
- **Midnight run (00:04 Cairo):** YESTERDAY's folder, frames with HHmm ≥ 1200. TWO reports, finish and save the first before starting the second:
  A = 1200–1759, `label` «تقرير العصر», file time `1800` · B = 1800–2359, `label` «تقرير الليل», file time `2359`.
- Camera names: 1 = الرصيف (برة), 2 = الرفوف, 3 = المكتب والكاونتر, 4 = الواجهة الزجاج, 6 = الرصيف (برة).
- Work one hour at a time and write findings as you go, so a stopped session loses nothing.

## 1. List frames (no download yet)
Drive `search_files`: `parentId = '<day folder id>'` with `excludeContentSnippets: true`, page through all results. Keep `title`, `id`, `fileSize`.
If there are no frames in the window: save a report with `"summary":[]`, `"pages":[]` and
`"note":"مفيش لقطات في الفترة دي — اتأكد إن السحب التلقائي شغال"`, then stop.

## 2. What to review (sampling)
**Target (whole period):** inside cameras 2, 3, 4 → EVERY frame (every 10 min). Outside cameras 1, 6 → one frame every 30 min, alternating (ch1 at :00, ch6 at :30), so each outside camera is seen hourly.
**Mode A — hourly bundles (preferred, when they exist):** the day folder (or its `bundles` subfolder) has `bundle_*.zip` files built by the server, each holding the selected frames of one hour (originals 960×576). Download ONE zip at a time (the result is saved to a file), unzip it, review the hour, then move to the next hour. If a zip is missing for an hour, use Mode B for that hour.
**Mode B — no bundles yet (current default):** download frames one by one, in batches of parallel calls, and prefer the `_s.jpg` copy (it arrives complete).
  Inside cameras: the frame at :00 and :30 of each hour. Outside cameras: one frame per hour (ch1 on even hours, ch6 on odd hours).
  Plus up to 10 "activity" frames: frames whose fileSize is clearly above that camera's median (≈ +12%).

## 3. Download and look
- `download_file_content(fileId)`. The result is saved to a file: decode with `jq -r .content <file> | base64 -d > x.jpg`
  and check the byte size equals `fileSize`. Never judge a partial image. A partial original → use the `_s.jpg` copy of the same frame.
- Files under ~45 KB (dark night frames) come back inline instead of a file. Do not paste them; use a neighbouring frame of the same camera,
  or list the camera in `note` as «ماتشافتش».
- **Grids first, for screening only:** with Python PIL build 4×3 grids (tiles 400×240 → image 1600×720), each tile labelled with time and camera.
  Group by camera and consecutive time (so changes are easy to see); the two outside cameras can share a grid. Use the grid to see who is where, a customer waiting, the desk occupied, lights.
- **Never judge a small item from a grid** (phone, keys, money, a bag, shelf gaps). For every suspicious frame open the original (or `_s.jpg`), crop and zoom 2×, then decide.
  If an area cannot be judged (night IR image, blur, too small), say so in `note` (e.g. «رص كاميرا 2 ماتقيّمش») — never write it as OK from the grid alone.
- Then crop and zoom (2×) every area that matters: desk, counter tops, shelves, drawers/doors, floor, diapers and milk shelves, outside steps.

## 4. Checklist (strict)
- Money visible anywhere (desk, counter). Keys, phones, drinks, papers on the desk.
- Someone sitting at the doctor's desk / on a phone while a customer waits. Customer waiting unserved.
- Staff without a white coat/uniform.
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
{"v":2,"date":"2026-11-01","time":"1200","label":"تقرير الضهر","dayLabel":"الأحد 1 نوفمبر","range":"12 م ← 12 ظ","by":"Claude","space":[960,576],
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
