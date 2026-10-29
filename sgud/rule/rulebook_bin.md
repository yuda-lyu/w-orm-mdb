# 規則帳本 — 外部執行檔類

本檔自 `sgud/rule/rulebook.md` 分拆(2026-10-30,mig-mdb2;全域設定 §14:過長即整理)。節號與標題不變,內容原樣搬移,未刪未改;「哪類查哪檔」之索引見 `sgud/rule/rulebook.md`。

## R-BIN 外部執行檔 connMDB.exe 之存放、下載、校驗與離線(2026-10-28 立;bin-mdb;D 類;制式規格正本:`C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md`,本節只摘要本套件之落實,規則不得與正本偏離)

### R-BIN-00 單一擁有者

- 取得執行檔路徑只有一個入口:`src/ensureBins.mjs`(轉呼叫 wsemi `fsEnsureBins`,`pkgRoot` 由 `import.meta.url` 推得為 `src/` 或打包後 `dist/` 之上一層,不依賴工作目錄)。**本套件不得自寫下載、快取、校驗、鏡像**(規格 E2)。唯一使用處為 `src/jet.mjs` 之 `getProg()`(每次 `runOnce` 呼叫,失敗整批 reject,此時尚未執行任何指令)。
- 清單 `bin/manifest.json`(`mode:"pinned"`、`repo:"yuda-lyu/w-orm-mdb"`、`commit` 為含 `bin/connMDB.exe` 之提交)由 `toolg/genBinManifest.mjs --commit <提交>` 依實檔產生,**不手寫**。

### R-BIN-01 規則

| 編號 | 規則 | 規格 | 落點 |
|---|---|---|---|
| B1 | 執行檔不入 npm 包,只有 `bin/manifest.json` 入包 | S1 | `.npmignore`:`/bin/*`、`!/bin/manifest.json`、`/bin-cache/`(不可寫 `bin/`) |
| B2 | 執行檔放自家 repo 之 `bin/`(入 git);D 類舊路徑 `src/connMDB.exe` 已移除(舊版隨 npm 包發布,不自 GitHub 取);`bin/** binary` | S2、F12 | `bin/connMDB.exe`、`.gitattributes` |
| B3 | 快取 `bin-cache/` 不入 git 與 npm 包 | S5 | `.gitignore`、`.npmignore` |
| B4 | 首次使用才取得,不在 `postinstall` | D1 | `jet.mjs` `getProg()`;`package.json` 無 install 類 script |
| B5 | 快取內容定址 `<快取>/<sha256>/connMDB.exe`,命中亦校驗;`W_BIN_CACHE`、`W_BIN_MIRROR`、`W_BIN_OFFLINE` 由 wsemi 統一讀取 | D3、D4、O1~O3 | `ensureBins()` 不轉傳 `floatingManifestUrl` |
| B6 | 匯出 `ensureBins()`:`WOrmMdb.ensureBins`(靜態屬性,維持單一 default 匯出,dist 之 UMD 形狀不變) | D1、E2③ | `src/WOrmMdb.mjs` 末段 |
| B7 | Jet 中介檔(`_<id>_in.json`、`_<id>_res.json`、`_<id>_q<k>.jsonl`)寫在 `os.tmpdir()`,**不寫在快取**(快取內容由清單校驗且可能共用或唯讀;舊版寫在 exe 旁之 `src/`) | — | `jet.mjs` `runOnce` |
| B8 | 取不到執行檔之錯誤為帶 `code` 之 `Error`(`E_OFFLINE_MISSING` 等),不再是字串 `can not find folder for connMDB` | E3 | `jet.mjs` 不吞錯 |

### R-BIN-02 更新流程(規格 U1,兩步提交)

1. 改 `srcCs/MdbBridge.cs`,於 srcCs 下以 csc(參數見 `srcCs/build.bat`,輸出 `..\bin\connMDB.exe`;經 git-bash 呼叫 cmd 會因中文路徑失敗,直呼 `%windir%\Microsoft.NET\Framework\v4.0.30319\csc.exe`)重編,跑 `npm test`。
2. **提交並推 GitHub**(得提交雜湊;執行檔之提交在前),再 `node toolg/genBinManifest.mjs --commit <該提交>` 產生清單(工具會拒絕 `bin/` 與該提交不一致者),清單於下一個提交。
3. 跑 `unit-binmanifest`(清單與實檔一致,且釘選提交內之位元組與工作樹相同),發布新版。

### R-BIN-03 對應測試(規格 §8)

| 規格 | 測試檔 › 案例 |
|---|---|
| T1 打包清單無執行檔 | `unit-binmanifest` › `should not pack external executables…`(`npm pack --dry-run --json`:無 exe/dll/msi/zip/7z、`bin/` 下只有 `manifest.json`、`src/ensureBins.mjs`、`src/jet.mjs` 在包內) |
| T2 `bin/` 實檔與清單一致 | `unit-binmanifest` › `should match the real files in bin/`、`should list every file in bin/ in the manifest`、`should have the pinned commit contain the same bytes as bin/` |
| M1/M2 清單形狀 | `unit-binmanifest` › `should be a pinned manifest…`、`should pass the schema check of fsEnsureBins` |
| T3 首次下載→校驗→快取;第二次不連網;網址釘選於清單之提交 | `unit-ensurebins` › `T3` |
| T4 雜湊/大小不符→拒用、不留檔 | `unit-ensurebins` › `T4`(同大小異內容 `E_HASH_MISMATCH`、截短 `E_SIZE_MISMATCH`) |
| T5 鏡像(本地資料夾、HTTP);鏡像檔被竄改→拒用 | `unit-ensurebins` › `T5`、`T5b` |
| T6 離線缺檔之錯誤格式 | `unit-ensurebins` › `T6`(名稱、sha256、大小、快取完整路徑)、環境變數案、`jet.mjs` 離線案 |
| T7 快取檔被竄改→重新取得;無鏡像則不回傳 | `unit-ensurebins` › `T7` |
| T8 主幹模式 | 不適用(本套件為釘選模式) |
| 整合:jet 經 ensureBins 實際執行、他處 cwd、中介檔位置 | `unit-ensurebins` › `jet.mjs obtains the executable through ensureBins and runs it`(3 案) |
| 功能測試之執行檔來源 | `test/tools/binEnv.mjs`(由 `unit-setup.mjs`、`tools/srcDir.mjs` 載入):把 `bin/connMDB.exe` 依清單 sha256 播種到預設快取 `bin-cache/<sha256>/`,並設 `W_BIN_OFFLINE=1`,令全套測試不連網;`bin/` 與清單不一致時離線明確失敗 |

### R-BIN-04 已知限制

1. 首次使用需連 GitHub 或有鏡像;無網路且無鏡像者以 `E_OFFLINE_MISSING` 明確失敗(README〈External executable〉有離線部署步驟)。
2. 每次 `runOnce` 皆呼叫 `ensureBins`(含 lock 競爭重試之每一輪),其成本為 wsemi 對已校驗檔之檔案識別比對,不重複雜湊;如需量測見 experience〈bin-mdb〉。
3. `WORM_SRC_DIR` 指向之 src 副本,其上一層須有 `bin/manifest.json` 與 `bin-cache/`(`srcDir.mjs` 註解);「修前紅」用之 HEAD 舊版 src 副本則仍依 cwd 之 `./src/connMDB.exe` 尋找(已不存在,須另行提供)。
4. 專案 `CLAUDE.md` 之〈exe 重編方式〉(輸出 `../src/connMDB.exe`)與 README 改動範圍描述尚未同步(`CLAUDE.md` 非本輪可改,已列入報告待裁示)。
