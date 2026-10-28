# 狀態(現況)

本檔只記現況(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本),不寫過程;過程與教訓見 `sgud/exp/experience.md`,規則細節見 `sgud/rule/rulebook.md`。

- 套件版本:`package.json` 為 1.0.42(HEAD 92b3a05 起);發布與版號由維護者與主控決定。
- 依賴現況:`node_modules` 之 `w-orm-reladb` 為 1.1.17、`wsemi` 1.9.25、`sequelize` 6.37.8;`package.json` 範圍 `w-orm-reladb ^1.1.17`(2026-10-28 mdb-run02 自 `^1.1.15` 升;下限由 `unit-diaglog` 釘住,見 R-DIAG-05)、`wsemi ^1.9.25`。

## 功能與規則、測試對照

| 功能 | 規則(rulebook) | 測試檔 | 狀態 |
|---|---|---|---|
| 七函數回傳形狀、事件 | 統一規格;CLAUDE.md | `unit-basic`、`unit-selectbypk`、`unit-insert`、`unit-insertbulk`、`unit-save`、`unit-del`、`unit-delall`、`unit-autogenpk`、`unit-event`、`unit-create-storage`、`unit-encryption`、`unit-concurrency` | 完成 |
| 主鍵命中判定(Jet 為準) | R-PK | `unit-pkvariant` 等 | 完成 |
| 條件(find)轉譯與系列白名單 | R-FIND、R-WL | `unit-find-basic/ops/pk/intpk/keys`、`unit-find-wl1~4`、`unit-find-wlx` | 完成 |
| 寫入 DATE 欄之日期範圍與字串正規化 | R-DATE | `unit-date-range`、`unit-date-write` | 完成 |
| sequelize 實例生命週期 | R-LIFE | `unit-instance-lifecycle` | 完成 |
| 非主鍵日期條件:浮動時間;非白名單欄型條件拒收 | R-FLOAT(含 R-FLOAT-07) | `unit-float-tz`、`unit-float-e2e`、`unit-float-twocopy`、`unit-find-coltype` | 完成 |
| 字串良構檢核 | R-WF | `unit-wf1~6`、`unit-wellformed` | 完成 |
| **診斷輸出之單一出口與預設安全(第 153 項)** | **R-DIAG** | **`unit-diaglog`(純函數,不需 Windows)、`unit-urlerr`(建構函式訊息,不需 Windows)、`unit-diaglog-wo`(實例,真 Jet)** | **完成(mdb-run01;mdb-run02 移除 `withDiagConsole`),待主控跑全套與發布** |

## 診斷輸出(R-DIAG)現況

- 單一出口 `src/getDiag.mjs`;`src/` 內除本檔外無 `console`、`process.stdout/stderr`、`emitWarning`;sequelize 之 `logging` 只傳函數或 `false`。
- 選項 `opt.logDetail`(`true` 還原舊輸出細節)、`opt.funLog(label, safe, detail)`(取代 console);預設只輸出固定標籤與不含個資之摘要(`change handler threw`、`error handler threw`、`sql { stmt }`)。連線字串與帳密於任何輸出管道(預設、logDetail、funLog、建構函式之例外訊息)皆以 `***` 遮罩。
- 回傳、事件 payload 與時機不變:固定預期值 `test/tools/diagGolden.json` 取自 HEAD 副本實跑。
- `genModelsByTabs`:以第 4 引數把本實例之 `diag` 傳給 w-orm-reladb(須 ≥ 1.1.17),預設輸出 `generate file: { name, type }`、`save file catch { name, type, errType[, errCode] }`(無路徑與錯誤文字),`logDetail`/`funLog` 由 `diag` 承接;**不替換全域 `console.log`**(`withDiagConsole` 與 `busy` 計數已於 mdb-run02 移除)。
- README:〈Diagnostic output〉與〈Breaking changes: diagnostic output〉兩節(專案 CLAUDE.md 之 README 改動範圍已含,主控 2026-10-28 同步)。

## 已知缺口與待辦

1. **依賴下限為 genModelsByTabs 預設安全之唯一防線**:w-orm-reladb < 1.1.17 不認得第 4 引數而直接 `console.log`(實測 1.1.15:路徑與錯誤文字全輸出,logDetail/funLog 皆不生效);`package.json` 下限 `^1.1.17`,`unit-diaglog`〈依賴w-orm-reladb之genModelsByTabs〉釘住(R-DIAG-05)。降版須同步取消該規則。
2. LDG2~8(R-DIAG-10):LDG2 已改為上條、Proxy 陷阱會被執行、sequelize 程式庫自身警告、Jet 後端錯誤文字為 reject 值之一部分(契約)、短密碼過度遮罩、非本實例憑證之盡力遮罩等,皆已文件化;LDG1(`maskUrl` 回顯 `@` 後主機之洩漏)已解除:連線字串無主機,`://` 之後一律不回顯。
3. 其餘既有已知限制見 rulebook 各節(L、L-FIND、L-WL、LD、LFL、LWF)。

## 最近一次驗證

- 2026-10-28 mdb-run02(對最終程式碼;依賴 w-orm-reladb 1.1.17):全套 `npm test`(`mocha --parallel "test/*.test.mjs"`)**3113 passing / 0 failing / 610 pending**,7 分 56 秒,exit 0;三個診斷測試檔共 122 案全綠(`unit-diaglog` 52、`unit-urlerr` 28、`unit-diaglog-wo` 42);修前紅:舊 `src` + 新依賴 93 案中 2 紅,新 `src` + 舊依賴 1.1.15 93 案中 8 紅;變異 11 個〔+ 基準 M00〕殺死 11、存活 0(初跑 M08 存活,補 R-DIAG-07 外層防護案後殺死);範例 `g-js`、`g-json`、`g-js-encryption` 輸出與檔尾註解一致,`g-js-concurrency` 輸出與前輪記錄 byte 相同;`npx eslint` 對修改檔 0 問題。報告 `C:\opensrcOper\dnow\20261028054319\agent-out\mdb-run02-修正報告.md`。
- 2026-10-28 mdb-run01(對最終程式碼):全套 `npm test`(`mocha --parallel "test/*.test.mjs"`)**3111 passing / 0 failing / 610 pending**,478 秒;三個新測試檔共 120 案全綠(`unit-diaglog` 52、`unit-urlerr` 28、`unit-diaglog-wo` 40);變異 57 個〔含 1 個基準〕殺死 56、存活 1(基準)、未套用 0、無效 0;範例 `g-js`、`g-json`、`g-js-encryption` 輸出與其檔尾註解一致,`g-js-concurrency` 與前輪記錄之輸出相同;`npx eslint` 對新增與修改檔 0 error。修前紅與外審見修正報告 `C:\opensrcOper\dnow\20261028054319\agent-out\mdb-run01-修正報告.md`。pending 610 為既有(wsemi 案例表中本套件無能力之 `gfs`、`doc` 等);genModelsByTabs 之 2 案已不再 pending。
