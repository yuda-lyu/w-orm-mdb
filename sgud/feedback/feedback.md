# 回饋

任務中發現之自有套件、全域技能、全域設定之調整與抽提提案;只增不改,處置結果另記一列並寫明承接哪一列。

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-19 | 自有套件 | wsemi 1.9.69 | 判斷函數只收原始值之變更(`isbol(new Boolean(false))` 由 `true` 改 `false`)令下游 `escVal`(`src/getCmd.mjs:72`)對 `new Boolean(..)` 之寫入值由 `True`(`new Boolean(false)` 亦被寫成 `True`)改為 `String(v)` 之 `'false'`/`'true'` 字串;此為下游行為變化,宜列入該版之下游影響說明(本庫已無測試依賴此行為,故不影響測試結果,僅供各使用端知悉) | `node --input-type=module` 實跑 `escVal(new Boolean(false))`:1.9.69 為 `'false'`;1.9.68 之 `isbol` 為 lodash `isBoolean`(`npm pack wsemi@1.9.68` 取得),對包裝物件為 `true` |
