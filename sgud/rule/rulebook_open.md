# 連線開啟失敗之有限重試(R-OPEN)

本檔為規則帳本 `rulebook.md` 之分檔(類型:連線開啟)。節號與標題為引用之錨。

背景:本套件為 one-shot(每次 `jet.run` 啟動一次 `connMDB.exe`,各自開啟與關閉連線)。多連線併發開啟同一 mdb 時,Jet 間歇令**開啟階段**失敗;該次呼叫尚未執行任何語句(exe 於開啟失敗時一律中止其後 cmds,令回傳之 `openFailed: true` 恆代表「零語句已執行」),故 `jet.run` 可整批重試而不重複套用寫入。重試僅限白名單錯誤碼。

## 規則

| # | 規則 | 位置 |
|---|---|---|
| R-OPEN-01 | 開啟失敗(`openFailed === true`)且 `results[0].errorCode` 屬 `codesTryOpen`(**3734、3050、3045、3031、3049、3356**)者,整批重試,**至多 8 次嘗試**(`nTryOpen`),各次嘗試間隔 `25ms × 序號`(`msTryOpen`;7 次間隔合計 700 ms,最後一次不等) | `src/jet.mjs` `run` |
| R-OPEN-02 | 次數用盡仍回報原錯誤:`run` 不 reject,回傳最後一次嘗試之結果物件(`ok:false`、`openFailed:true`、`results[0].errorCode` 與 `error` 保留);經 `query`/`execute`(`runOne`)者 reject 為錯誤訊息**字串**(形狀同重試前) | `src/jet.mjs` `run`、`runOne` |
| R-OPEN-03 | 永久性開啟失敗(檔案不存在 3024、格式不符 3343、**無錯誤碼**〔非 OleDb 例外或無 SQLState,`errorCode` 為 0〕等不在白名單者)不重試,只嘗試 1 次即回報 | `src/jet.mjs` `run` |
| R-OPEN-04 | 非開啟失敗(`openFailed` 非 true,即已有語句執行或失敗發生於開啟之外)一律不重試,即使錯誤碼在白名單內;每次嘗試送出之 `db`、`useTransaction`、`cmds` 相同(query 之 `fpOut` 路徑每次另生) | `src/jet.mjs` `run`、`MdbBridge.cs`(`openFailed` 僅於 `parts.Count == 0` 且開啟拋例外時設) |
| R-OPEN-05 | 真實 Jet:錯誤密碼(3031)重試用盡後仍回報(`ok:false`、`openFailed:true`、`errorCode 3031`、原訊息);開啟失敗時 exe 中止其後 cmds(`results` 只有第 1 筆,`stopped:true`)——此為 R-OPEN-01 重試安全之前提 | `src/jet.mjs`、`srcCs/MdbBridge.cs` |

### 白名單之依據(實測,2026-11-05;採「依實測所見之碼」,非窮舉)

探測(純讀、零寫入、每輪換新 mdb 複本、16 並行;直接對 `connMDB.exe`,不經重試):約 0.7~1.2% 之呼叫於首次嘗試開啟失敗,**皆為 `openFailed: true`**,碼與訊息:

| 碼 | 訊息(英文系統) | 備註 |
|---|---|---|
| 3734 | The database has been placed in a state by user '…' on machine '…' that prevents it from being opened or locked. | 既有;使用者/主機名稱有時為空字串、有時為 `Admin`/本機名 |
| 3050 | Could not lock file. | 既有 |
| 3031 | Not a valid password. | **對無密碼之檔、連線字串不帶密碼亦出現**;與 3734 同批出現 |
| 3049 | Cannot open database ''.  It may not be a database that your application recognizes, or the file may be corrupt. | 檔名為空字串;資料庫實際完好 |
| 3045 | Could not use ''; file already in use. | 檔名為空字串 |
| 3356 | You attempted to open a database that is already opened exclusively by user … Try again when the database is available. | 連線字串無獨占設定;Jet 自己的訊息即建議重試 |

機制為**推測**:引擎讀到另一連線正在建立或釋放時尚未就緒之鎖檔/檔頭狀態(訊息中之檔名為空字串即其徵象);資料庫與密碼本身無誤,立即重試即可開啟。未證實,亦無從在本套件端消除(競爭在 Jet 引擎內部;exe 之 `cnNew.Open()` 為拋例外處)。

## 已知限制(LO)

| # | 內容 |
|---|---|
| LO1 | **白名單依實測所見,非窮舉**:併發開啟若出現其他暫態碼,仍會被當成永久性而原樣回報;出現時加入 `codesTryOpen` 並補 `unit-jet-retry` 一案。探測中曾因 3356 未納入而殘留失敗(1600 次中 2 次),納入後 1600 次 0 失敗 |
| LO2 | **永久性的 3031/3049/3045/3356 回報變慢**:這四碼亦可為真實的永久性問題(錯誤密碼、檔案毀損、被他程序獨占),無從由錯誤碼區辨,故同樣重試至用盡才回報。實測**錯誤密碼:修前約 0.33 秒、修後約 3.4 秒**(5 次 3.34~3.57 秒;8 次 exe 啟動各約 0.3 秒 + 退避 0.7 秒);檔案不存在(3024)仍約 0.33 秒 |
| LO3 | `useStable:true`(預設)時各呼叫經模組層共用之 `pmQueue(1)` 序列化(不分資料庫):連續 N 個永久性失敗呼叫(如錯誤密碼)最後一個約等 N × 3.4 秒;修前約 N × 0.33 秒 |
| LO4 | 縮短之選項(未採用,留給主控裁示):對語意模糊之 3031/3049/3045/3356 另設較少嘗試(如 4 次,永久性失敗約 1.4 秒)。依據:探測 1600 次呼叫中 14 次需重試,**全部第 2 次嘗試即恢復**,無需 3 次以上。未採用因派工指定單一有限重試且已明載該時間 |
| LO5 | 重試不跨呼叫:`save` 等一次公開呼叫內有多次 `jet.run`(預讀、寫入),各自獨立重試;任一次用盡即整批 reject(`WOrmMdb.mjs` 之 `openFailed` 檢查),前一次 run 已生效之寫入不回滾(既有行為,非本規則引入) |

## 站點全集(`jet.run` 之呼叫端;皆依 `openFailed`/`ok` 回報,無降為成功者)

`src/WOrmMdb.mjs`:`resolvePkIdx` ⟨:776⟩、`findAll` 之 `jet.query` ⟨:829⟩、`selectByPk` 之 `jet.query` ⟨:1010⟩、`getExistPks`/`getExistPksExact` ⟨:1083、:1118⟩、`insert` ⟨:1246⟩、`insertBulk`(交易)⟨:1437⟩、`save` 預讀 ⟨:1647⟩ 與寫入 ⟨:1734⟩、`del` ⟨:2010⟩、`delAll` 之 `jet.execute` ⟨:2163⟩ 與批次(交易)⟨:2195⟩;`createStorage` 之 `jet.create` ⟨:2262⟩ 為單一 `create` 指令,不開連線、不設 `openFailed`,不重試。〔行號為 2026-11-05 之值〕

## 對應測試

| 規則 | 測試 |
|---|---|
| R-OPEN-01~04 | `test/unit-jet-retry.test.mjs`:以假執行檔(`test/tools/fakeConnMDB.cs`,依腳本檔逐次回傳預寫之結果並記錄次數與每次輸入)取代 `connMDB.exe`,於 `test/temp-jet-retry/` 建一份套件根(`src/jet.mjs`、`src/ensureBins.mjs` 為 `src/` 之逐位元組複本,清單與快取指向假執行檔),令受測之 `jet.mjs` 走完整之 `ensureBins → execProcess → 結果檔` 路徑,不改任何受測原始碼。6 碼 × (重試至成功、用盡回報、非開啟失敗不重試)、混合序列、最後一次機會才成功、退避時間下限、`execute`/`query` reject 字串形狀、永久碼 3 案、每次嘗試輸入相同(含 `useTransaction`) |
| R-OPEN-05 | 同檔(真實 `src/jet.mjs` 與真實執行檔):錯誤密碼加密檔、正確密碼對照、不存在檔案之 `[execute, execute]` 只回第 1 筆 |
| 經公開 API 之密碼錯誤 | `test/unit-encryption.test.mjs`〈錯誤密碼開啟加密檔被拒〉(斷言 `Not a valid password`,維持不變;現約 3.6 秒) |
| 併發(真實 Jet,機率性) | `test/unit-concurrency.test.mjs`(`useStable:false` 之 20 並行 save 要求逐筆 `ok:1`)、`test/unit-instance-lifecycle.test.mjs`(8 次並行 select);兩者先前之機率性紅(LD4)即本規則所解 |

## 修前/修後數據(2026-11-05,第 319 項)

| 項目 | 結果 |
|---|---|
| 兩測試檔(`unit-concurrency`、`unit-instance-lifecycle`)各 10 輪(`mocha --parallel`),現版依賴(wsemi 1.9.51、w-orm-reladb 1.1.28、w-auto-sequelize 1.0.61),修前 | 1/10 輪紅(`Cannot open database ''`,`unit-concurrency` 20 並行 save) |
| 同上,舊依賴(wsemi 1.9.49、w-orm-reladb 1.1.27、w-auto-sequelize 1.0.60),修前 | 0/10 輪紅 |
| jet 層探測(16 並行 × 50 輪 = 800 次呼叫,每輪換新複本,經 `jet.run`),現版依賴,修前 | 7/800 失敗(3031×5、3049×1、3045×1) |
| 同上,舊依賴,修前 | 10/800 失敗(3049×4、3031×5、3045×1) |
| 同上,現版依賴,修後(白名單加 3045/3031/3049) | 0/800 失敗 |
| 重試迴圈複製探測(16 並行 × 100 輪 = 1600 次),白名單未含 3356 | 2/1600 殘留失敗(3356);14 次需重試 |
| 同上,白名單含 3356 | 0/1600 失敗;14/1600 需重試,全部第 2 次嘗試即恢復 |
| 兩測試檔 10 輪,現版依賴,修後(白名單含 3045/3031/3049,未含 3356) | 0/10 輪紅 |
| 序列(非並行)呼叫 400 次(直接對 exe,純讀) | 0/400 失敗:`useStable:true` 之單行程序列化不受影響;暴露面為 `useStable:false` 並行與跨行程併發 |
| `unit-jet-retry`(33 案)於修前白名單(HEAD 值 `[3734, 3050]`) | 15 紅 / 18 綠(綠者為 3734、3050 對照組、永久性、非開啟失敗不重試等);修後 33 綠 |
| 變異(對 `src/jet.mjs` 重試迴圈 18 個:白名單逐碼移除/加入永久碼、嘗試上限 ±、移除 `openFailed` 閘門、移除永久碼閘門、退避改 0/改常數、讀錯錯誤碼位置、丟掉 `useTransaction`、抹掉回傳之 `openFailed`) | 18/18 殺死(初跑 M15〔退避改固定 25ms〕存活,因測試的時間下限混入假執行檔啟動時間;改以假執行檔記錄之各次起訖時間核對相鄰嘗試之間隔後殺死) |
| 全套 `npm test`(`quiet-run --lock`)2 次 | 各 3185 passing / 610 pending / 0 failing(較 3152 增 33 案) |

回歸判定:依賴由 wsemi 1.9.49→1.9.51、w-orm-reladb 1.1.27→1.1.28、w-auto-sequelize 1.0.60→1.0.61 之 `src/` 逐檔比對,僅 wsemi 之 `_execPortPids.mjs`、`execProcessPortPids.mjs`、`execProcessPortPidsSync.mjs` 三檔不同(行程埠查詢工具,本套件不引入);w-orm-reladb 與 w-auto-sequelize 之 `src/` 完全相同(僅 `package.json` 版本與相依範圍)。exe 層探測(不經任何 node 依賴)亦重現同樣之錯誤與頻率。**非回歸**,為既存之機率性失敗(`experience.md` 已載「偶發 3031」)。
