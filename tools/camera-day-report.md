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

## أولوية الاكتشاف قبل التفاصيل — 2026-11-05
- امسح الشبكات أولًا بحثًا عن أحداث كبيرة غير عادية: خطر على السلامة، عائق كبير، دخول جسم/مركبة غير معتاد، ازدحام واضح أو تعطل ظاهر في مساحة العمل. لا تبدأ بحصر العلب المائلة قبل إكمال مسح المشهد كله.
- افحص الصورة الأصلية والتكبير قبل تأكيد أي حدث. لا تستنتج انتظارًا أو إهمالًا أو مدة من صورة ثابتة.
- صنّف الملاحظات حسب أثرها: (1) خطر أو تعطيل واضح، (2) خدمة العميل أو عائق عمل مثبت، (3) فوضى ونظافة مؤثرة، (4) تفاصيل الرص الصغيرة. لا تجعل كثرة التفاصيل الصغيرة تحجب مشكلة كبيرة واحدة.
- قبل حفظ التقرير أعد فحص الشبكات والأصول بحثًا عن أكبر حدث فاتك، ثم راجع الملاحظات الصغيرة بحثًا عن تخمينات أو تكرارات.
- المخالفة الواحدة في نفس الموضع لها سجل واحد في summary حتى لو ظهرت بأوقات متعددة؛ سجّل أوقات الظهور الفعلية، ولا تدّع الاستمرار بين اللقطات. لا تكرر نفس المخالفة كأنها جديدة لمجرد اختلاف الصورة.
- **توافق العرض الحالي:** لا تُنشئ صفحات أصلية متعددة لنفس المخالفة دون معلومة جديدة، لكن لا تُخفِ دليلًا لازمًا. حقل repeats يضم الصور الإضافية؛ لاحظ أن الداشبورد الحالي يفرد repeats كصفحات مستقلة، ولذلك تجميعها بصريًا في صفحة واحدة يحتاج تعديل واجهة مستقل، ولا يمكن للبرومبت وحده ضمانه.

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

## 4أ. مراجعة صارمة على مرحلتين — strict-review-2026-11
طلب أحمد تشديد دقة المراجعة: لا تجامل في الوصف ولا تسقط مخالفة صغيرة واضحة، ولا تختلق مخالفة لتعويض نقص الصور. لا تستهدف درجة منخفضة أو عددًا معينًا من الملاحظات؛ اتبع الدليل.

**المرور الأول: حصر ما يظهر.** لكل أصلية مختارة كاملة افتح قصاصات 2× تغطي المناطق الآتية المتاحة في الكادر، يمينًا ووسطًا ويسارًا؛ لا تكتفِ بمنتصف الصورة:
- كاميرا 2: كل جزء ظاهر من صفوف الأدوية، واجهات العلب وحواف الرف، الحفاضات منفصلة، رف اللبن، أعلى الوحدات والأرض والممر تحتها. افحص العلب الملقاة والمائلة والبارزة والصفوف المتداخلة والتكديس؛ غياب مرجع ترتيب لا يمنع إثبات ميل/سقوط واضح، لكنه يمنع ادعاء نقص المخزون.
- كاميرا 3: سطح المكتب كله وحوافه، محيط الشاشة والكمبيوتر، مساحة خدمة العميل، الزجاج والأسطح، الأدراج والأبواب الظاهرة، أسفل المكتب والأرض. لا تُهمل الأطراف أو خلف الأغراض الكبيرة.
- كاميرا 4: مساحة الكاونتر الظاهرة، المدخل والدرجات والممر، الأرض والزجاج والأبواب، أي كراتين أو أغراض فوق وحدات العرض.
- كاميرا 1 و6: المدخل والدرجات والرصيف، أكياس/قمامة/مخلفات، عوائق المرور الظاهرة وحالة العرض والإضاءة.
لكل منطقة سجّل داخليًا ما فُحص وما حجب الرؤية. ما لم يُفتح ويُكبَّر يُعد غير مفحوص، لا سليمًا. التكبير لا يخلق تفاصيل غير موجودة؛ المجهول يظل مجهولًا.

**المرور الثاني: ابحث عما فاتك.** ارجع لنفس الأصول والقصاصات، دون تنزيلها مرتين، وراجع قائمة: فلوس/هاتف/مفاتيح/مشروبات/أوراق؛ أكياس وكراتين؛ فوضى الأسطح ومحيط الكمبيوتر؛ أدراج وأبواب؛ رص الأدوية؛ رص الحفاضات واللبن؛ الأرض والمدخل؛ تلف وإضاءة. لكل مرشح اكتب حكمًا واحدًا: مخالفة مؤكدة مع دليل، استخدام عمل ظاهر مع سبب بصري، أو غير متحقق منه مع سبب. ممنوع افتراض «طلب بيتجهز» أو «حاجة مستخدمة مؤقتًا» لمجرد تبرير فوضى واضحة؛ الاستثناء يحتاج دليل استخدام ظاهر في العينة، وإلا صف الغرض ومكانه دون تخمين مدته أو غرضه. الهاتف/الورق/الأداة المستخدمة لا تصبح مخالفة تلقائيًا؛ قيّم موضعها والتعطيل وما يظهر فعلًا.

**أثر يمكن مراجعته في التقرير.** أضف `reviewProtocol:"strict-review-2026-11"` و`reviewAudit` (سجل لكل منطقة من العشر: `zone`, `evidence` بمعرفات الصور المفتوحة فعلًا، `result` = `issue` أو `clear` أو `unverified`, و`reason` مختصر محدد). `clear` لا يُكتب إلا بعد فحص جميع الأجزاء الظاهرة ذات الصلة، مع ذكر الجزء المحجوب إن وجد؛ الجزء اللازم المحجوب يجعل المنطقة غير مقيمة. سجل الملاحظات التاريخية أثناء الفترة في summary/pages حتى لو انتهت قبل آخر عينة؛ لا تخصمها من الحالة النهائية إذا ثبت زوالها. لا تخترع counts أو مرات أو مدد بين اللقطات.

**بوابة الحفظ:**
1. راجع كل منطقة من العشر وكل كاميرا في العينات المختارة؛ اذكر بوضوح غير المقيم وسبب الاستبعاد. لا تمنح assessed=true لمنطقة بناءً على عدم ملاحظة مشكلة فقط.
2. كل مخالفة مؤكدة لها وصف محدد (غرض/حالة/موضع)، كاميرا، وقت، وأصلية عليها سهم دقيق. لو أكثر من 8 في الأصلية، استخدم صفحة إضافية من نفس الأصلية؛ لا تسقط الباقي.
3. طابق summary مع pages ومع assessment. كل خصم له مخالفة موثقة، وكل مخالفة حالية تخص الشكل موجودة في issues بالمنطقة المناسبة. «بسيطة» تظل مسجلة ويطبق عليها خصم المعيار؛ لا تُحذف لتحسين الدرجة. لا تكرر نفس الفوضى كخصومات لكل غرض أو لكل زاوية.
4. ممنوع «تمام/ممتاز/مفيش مشاكل» كتقييم عام مع مناطق غير مفحوصة. قل «لم تظهر ملاحظات مؤكدة في الأجزاء المفحوصة» وحدد التغطية. راجع أي منطقة حصلت على الدرجة الكاملة مرة ثانية واكتب سببًا بصريًا محددًا في reviewAudit، لا «الصورة كويسة».
5. لا تستنتج انشغال موظف/تجاهل عميل/زمن انتظار من وضعية ثابتة أو لقطة هاتف. سجل المشهد المحقق، واذكر أن استنتاج الخدمة أو المدة غير متاح عندما لا تكفي العينات. لا تعد فراغ الرف إثباتًا لنفاد صنف، ولا الظل/الانعكاس اتساخًا.
6. أجرِ المراجعتين على نفس العينات الحالية؛ لا تغيّر تواتر السحب ولا تفعّل -next ولا توسع الإضافات المعتمدة. تعذر الفحص يُذكر صراحة بدل تقييم متساهل أو مختلق.

## Appearance score and previous-report comparison
Read and follow `tools/camera-appearance-kpi.md`. Before judging, read the previous period's report and evidence; preserve stable problem IDs. Add the ten evidence-backed checks and issue states there to JSON v2. Do not fabricate ratings for legacy reports. Never close a previous issue from an absent or obscured camera view. Keep actual image sampling bounded; this does not enable -next or change capture.

## 5. Group and build pages
- Group the same problem across times (same thing, same place). Count it and list its times (HH:MM, 12-hour, Latin digits).
- One page = one frame. Put on it every problem visible in that frame (max 8 numbered labels).
  Choose frames so that EVERY problem in the summary appears on at least one page.
- `repeats` on a page = other frames where the page's main problem also shows: `crop` = [x, y, w, h] around it in 960×576, keep 4:3 (e.g. 320×240).
- **Evidence density (owner request 2026-11-05):** For each confirmed distinct issue, aim to display **3–4 strong, non-duplicate supporting frames** from different times or viewpoints when available. Select the clearest original as the main `page` and put the other verified frames in `repeats` with precise crops and actual timestamps. Do not artificially pad to 3–4: if only 1–2 genuinely distinct frames verify the issue, show only those and explicitly note limited evidence. Do not repeat near-identical frames or invent duration/continuity between observations. Keep all issue labels tied to the correct frame and location.
- **Audit counts separately:** `reviewedFrames`/the review note must reflect frames actually inspected, while displayed evidence frames count only the selected main frame plus valid `repeats`. Do not claim every sampled frame proves the issue. Preserve the existing one-main-page-per-issue grouping; do not create duplicate summary issues or duplicate pages just to increase evidence count.

- Label text `now` = the problem only, ≤ 4 words (no «المفروض»). Labels are drawn as white pills ≈ (11 px × characters + 60) wide, 42 px tall in 960 space.
  `to` = exact point of the problem. `lab` = pill centre on an empty area (floor, wall, ceiling), inside the image, not covering the problem or another pill.
- **Mandatory arrow QA:** `to`, `lab` and `crop` must use the ORIGINAL 960×576 image coordinates, not enlarged preview/screenshot coordinates. For each point require 0 ≤ x < 960 and 0 ≤ y < 576; each crop rectangle must stay entirely inside the image. Open the original frame and verify each arrow tip precisely touches the issue named in `now` (not merely somewhere in bounds). Recheck all arrows and labels visually before saving. If any point is out of bounds, incorrectly scaled, or does not touch the cited issue, correct it or omit that annotation. Never reuse coordinates from another camera/frame. Reject and repair any report with invalid coordinates before upload.\n- Summary: `sev` "r" = money/people/customer problems, "y" = order/cleanliness/stock problems. Order: r first.

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


