# 狀態(現況)

本檔只記現況(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本),不寫過程;過程與教訓見 `sgud/exp/experience.md`,規則細節見 `sgud/rule/rulebook*.md`(2026-10-30 起依類型分拆:`rulebook.md` 為「哪類查哪檔」之索引,規則在 `rulebook_pk.md`、`rulebook_find.md`、`rulebook_float.md`、`rulebook_data.md`、`rulebook_diag.md`、`rulebook_bin.md`;節號與標題不變)。

- 套件版本:`package.json` 為 1.0.44;發布與版號由維護者與主控決定。
- 依賴現況:`node_modules` 之 `w-orm-reladb` 為 1.1.18、`wsemi` 1.9.31、`sequelize` 6.37.8;`package.json` 範圍 `w-orm-reladb ^1.1.18`、`wsemi ^1.9.31`(2026-10-30 mig-mdb 自 `^1.1.17`、`^1.9.27` 升:wsemi 診斷共用模組自 1.9.31 起,reladb `genModelsByTabs` 之 diag 參數契約〔wsemi getDiag 實例〕與 `src/ownErr.mjs` 自 1.1.18 起;下限由 `unit-diaglog` 釘住)。

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
| **診斷輸出與遮罩:改用 wsemi 共用模組(第 161 項第 3 波;原第 153 項之自寫 `getDiag.mjs` 已刪)** | **R-DIAG(以 R-DIAG-13 為準)** | **`unit-diaglog`(純函數與原始碼盤點,不需 Windows)、`unit-urlerr`(建構函式訊息,不需 Windows)、`unit-diaglog-wo`(實例接線,真 Jet)、`unit-diaglog-wire`(對外錯誤值接線與共用語料,真 Jet)** | **完成(mig-mdb,2026-10-30;mig-mdb2 補 LDG10〔maskDialect 白名單〕與帳本分拆),待主控複審與發布** |
| **外部執行檔 `connMDB.exe` 之存放/下載/校驗/離線(D 類制式規格)** | **R-BIN** | **`unit-binmanifest`(T1、T2、清單形狀;與平台無關)、`unit-ensurebins`(T3~T7、環境變數、jet 整合;整合 3 案僅 Windows);功能測試之執行檔由 `test/tools/binEnv.mjs` 供** | **完成(bin-mdb,2026-10-28),待主控跑全套與發布** |

## 外部執行檔(R-BIN)現況

- `connMDB.exe` **不隨 npm 包發布**;包內只有 `bin/manifest.json`(pinned,`commit` 3ca537c26e10dbe9009d2e4f79f05576adfa21a8,sha256 `aa58592a…a4b1`,11776 位元組)。`src/connMDB.exe` 已移除,執行檔在 `bin/connMDB.exe`(入 git;`.gitattributes` `bin/** binary`)。
- 取得入口 `src/ensureBins.mjs`(wsemi `fsEnsureBins`);`jet.mjs` 每次 `runOnce` 經 `getProg()`;預設快取 `<套件根>/bin-cache/<sha256>/connMDB.exe`,環境變數 `W_BIN_CACHE`、`W_BIN_MIRROR`、`W_BIN_OFFLINE`;`WOrmMdb.ensureBins()` 供預先取得。Jet 中介檔改寫 `os.tmpdir()`。
- 改 exe 之流程見 R-BIN-02(兩步提交);`srcCs/build.bat` 輸出已改 `..\bin\connMDB.exe`。
- README:〈External executable〉與〈Breaking changes: external executable〉兩節(新增;專案 CLAUDE.md 之 README 改動範圍待主控同步)。
- 待辦:發布前在連網機器實跑一次 `WOrmMdb.ensureBins()` 確認真實 GitHub 網址之下載(測試不連外網,未實測);專案 `CLAUDE.md` 之〈exe 重編方式〉、〈測試〉、〈README〉三處待主控同步。

## 診斷輸出(R-DIAG)現況

- 出口為 wsemi `getDiag` 實例(`src/WOrmMdb.mjs`;cfg:`getDiagSecrets({ urls, username, password, paths })`、`patterns: ['mdbUrl']`、`safeKeys: ['stmt','mode','name','type']`);`src/` 無任何 `console`、`process.stdout/stderr`、`emitWarning`;sequelize 之 `logging` 只傳函數或 `false`。`getSqlStmt`、`maskDialect` 各為 `src/` 下之獨立檔;`maskDialect`(建構函式訊息 `dialect[…] is not mdb`)只回顯已知方言名(`mdb`、`mssql`、`sqlite`、`mysql`、`mariadb`、`postgres`;不分大小寫、回小寫形),其餘一律 `***`(與 `maskDiagUrl` 之 R13 策略一致)。
- 選項 `opt.logDetail`(`true` 輸出 `(label, 遮罩後細節)`)、`opt.funLog(label, safe, detail)`(取代 console);預設只輸出 `change handler threw`、`error handler threw`、`sql` 之標籤與 safe 摘要。`throwUrlErr` 經 `maskDiagUrl`(schemes `['mdb']`)。
- 對外錯誤值:整批 reject 與 'error' 事件經 `outErr`(外來值 `diag.err`,本套件固定詞彙依 w-orm-reladb `ownErr` 登記、`si.err`、`ERR_NOT_ARR`/`ERR_NO_RES` 原樣),逐筆 err 於建立時 `diag.mask`;快照、close、initSequelize 之外來失敗經 `diag.err`。只遮憑證,不遮單獨帳號與儲存路徑(dspec Q3)。
- 回傳契約:不含憑證之情境不變,`test/tools/diagGolden.json` 未重產。
- `genModelsByTabs`:第 4 引數傳本實例之 wsemi `diag`(w-orm-reladb ≥1.1.18 之契約);**不替換全域 `console.log`**。
- README:〈Diagnostic output〉改指 wsemi;〈Breaking changes: diagnostic output〉末段加「Shared diagnostic module of wsemi」(依專案 CLAUDE.md 不另立新節)。

## 已知缺口與待辦

1. **依賴下限為 genModelsByTabs 契約之防線**:w-orm-reladb < 1.1.18 之 diag 參數非 wsemi 實例之契約;`package.json` 下限 `^1.1.18`,`unit-diaglog`〈依賴w-orm-reladb之genModelsByTabs之diag參數契約〉釘住。降版須同步取消。
2. 已知限制(R-DIAG-13):LDG9 密碼含未編碼 `@` 之尾段單獨出現時不遮;LDG11 reject 清單之短密碼(<4)不遮;LDG12 `init()` 回傳之內部 `jet` 由呼叫端直接呼叫時其錯誤文字為原文(主控裁定維持,不改介面);其餘依 wsemi R-DIAG-01 之已知限制。LDG10(`dialect[…]` 回顯看似 scheme 之秘密)已於 mig-mdb2 解決:`maskDialect` 只回顯已知方言名(見 R-DIAG-13〈mig-mdb2〉)。
3. 其餘既有已知限制見 rulebook 各節(L、L-FIND、L-WL、LD、LFL、LWF)。

## 最近一次驗證

- 2026-10-30 mig-mdb2(主控裁定:LDG10 選 B〔`maskDialect` 白名單〕、帳本分拆;對最終 src,單次 `quiet-run --lock`):全套 `npm test` **3152 passing / 610 pending / 0 failing**,exit 0(9 分 21 秒;較 mig-mdb 之 3140 增 12 案:`unit-diaglog` +4、`unit-urlerr` +7、`unit-diaglog-wire` +1〔mig-mdb 全套後才加入者〕);受影響 4 檔(`unit-diaglog` 21、`unit-urlerr` 36、`unit-diaglog-wo` 42、`unit-diaglog-wire` 45)**144/144**;修前紅(修改前之 `maskDialect` + 新測試)`unit-diaglog`+`unit-urlerr` 57 案中紅 15;變異 19 個殺死 19、存活 0;`npx eslint` 對修改檔 0 問題。帳本分拆:`rulebook.md` 143,591 位元組 → 索引 + `rulebook_pk/find/float/data/diag/bin.md`(各節逐字搬移、位元組守恆;引用核對前後未定義集合相同)。報告 `C:\opensrcOper\dnow\20261029002013\agent-out\mig-mdb2-修正報告.md`。
- 2026-10-30 mig-mdb(改用 wsemi 1.9.31 共用診斷模組,依賴 w-orm-reladb 1.1.18;對最終 src):全套 `npm test` **3140 passing / 610 pending / 0 failing**,exit 0(7 分 46 秒);受影響 4 檔(`unit-diaglog` 17、`unit-urlerr` 29、`unit-diaglog-wo` 42、`unit-diaglog-wire` 45)**133/133**;修前紅(HEAD 之 src + 新測試)127 案中紅 60;變異 39 個殺死 39、存活 0(M06、M19 另以補之行為案重驗殺死);範例 4 支於 HEAD 副本與現況輸出相同;`npx eslint` 對修改檔 0 問題。報告 `C:\opensrcOper\dnow\20261029002013\agent-out\mig-mdb-修正報告.md`。
- 2026-10-28 bin-mdb(D 類外部執行檔制式規格,對最終程式碼;依賴 wsemi 1.9.27):全套 `npm test` **3130 passing / 0 failing / 610 pending**,8 分 57 秒,exit 0(前輪 3113 → +17 為 `unit-binmanifest` 6 案、`unit-ensurebins` 11 案);修前紅:`unit-binmanifest` 因缺 `bin/manifest.json` 載入即失敗,修前 `npm pack --dry-run` 含 `bin/connMDB.exe` 與 `src/connMDB.exe`;變異 10 個殺死 10、存活 0(基準 17 綠);範例 `g-js`、`g-json`、`g-js-encryption`、`g-js-concurrency` 於 HEAD 副本與現況輸出(隨機 id 正規化後)逐行相同;UMD 打包後於他處 cwd 實跑 `ensureBins()`、`insert`/`select` 成功;`scan-bins --only w-orm-mdb` = OK;`npx eslint` 對修改檔 0 問題。未做:真實 GitHub 網址之下載(測試不連外網)。報告 `C:\opensrcOper\dnow\20261028054319\agent-out\bin-mdb-修正報告.md`。
- 2026-10-28 mdb-run02(對最終程式碼;依賴 w-orm-reladb 1.1.17):全套 `npm test`(`mocha --parallel "test/*.test.mjs"`)**3113 passing / 0 failing / 610 pending**,7 分 56 秒,exit 0;三個診斷測試檔共 122 案全綠(`unit-diaglog` 52、`unit-urlerr` 28、`unit-diaglog-wo` 42);修前紅:舊 `src` + 新依賴 93 案中 2 紅,新 `src` + 舊依賴 1.1.15 93 案中 8 紅;變異 11 個〔+ 基準 M00〕殺死 11、存活 0(初跑 M08 存活,補 R-DIAG-07 外層防護案後殺死);範例 `g-js`、`g-json`、`g-js-encryption` 輸出與檔尾註解一致,`g-js-concurrency` 輸出與前輪記錄 byte 相同;`npx eslint` 對修改檔 0 問題。報告 `C:\opensrcOper\dnow\20261028054319\agent-out\mdb-run02-修正報告.md`。
- 2026-10-28 mdb-run01(對最終程式碼):全套 `npm test`(`mocha --parallel "test/*.test.mjs"`)**3111 passing / 0 failing / 610 pending**,478 秒;三個新測試檔共 120 案全綠(`unit-diaglog` 52、`unit-urlerr` 28、`unit-diaglog-wo` 40);變異 57 個〔含 1 個基準〕殺死 56、存活 1(基準)、未套用 0、無效 0;範例 `g-js`、`g-json`、`g-js-encryption` 輸出與其檔尾註解一致,`g-js-concurrency` 與前輪記錄之輸出相同;`npx eslint` 對新增與修改檔 0 error。修前紅與外審見修正報告 `C:\opensrcOper\dnow\20261028054319\agent-out\mdb-run01-修正報告.md`。pending 610 為既有(wsemi 案例表中本套件無能力之 `gfs`、`doc` 等);genModelsByTabs 之 2 案已不再 pending。
