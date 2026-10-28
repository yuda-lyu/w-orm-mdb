# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

## Jet 4.0 之主鍵等值與轉型(2026-10-14 實測,探測 `tmp/audit01/probe/p1-jet-raw.mjs`)

- 文字等值:不分大小寫(含非 ASCII,如 é/É、σ/Σ、я/Я、ǆ/ǅ)、**忽略尾端半形空白**(存值保留空白)、忽略全半形寬度(`Ａ１`≡`A1`)、忽略平/片假名(`か`≡`カ`≡`ｶ`)、`ß≡ss`、`ς≡σ`、`æ≡ae`、`œ≡oe`;不忽略前導空白、Tab、換行、NBSP、全形空白、零寬空白、軟連字號、連字號;`ẞ≢ß`、`ı≢I`、`i≢İ`、`ü≢ue`、`å≢aa`。`''`≡`'   '`(DDL 建之 TEXT 欄允許空字串)。Access 2021 建檔、ADOX 新建、測試資產三者相同。
- JS `toLowerCase` 與 sqlite `NOCASE` 皆無法重現上述集合;凡要判定主鍵等值,**交 Jet 判定**,JS 端只做「只會少判」之快速鍵(去尾端 U+0020 + ASCII 小寫)。
- **不要再嘗試以 JS 仿製 Jet 之等值鍵**(2026-10-16 教訓):初版 jetKey(NFKC+大小寫折疊)經 1720 字元分組實插 Jet 多判 75 組(`ı/I`、`ſ/S`、`①/1`、Kelvin K、數學字母…);即使收斂到 0 多判,少判仍在(Jet 忽略增補平面字元:`'a😀'≡'a'`、`'😀'≡'😁'`;CURRENCY 欄會把常值轉成欄之精度),而**否定條件($ne/$nin/$not)下少判即誤刪**。select/delAll 之主鍵等值已改為「存值快速鍵對應,對不上者逐筆 `=` 問 Jet,條件改寫為原列序號集合」(`resolvePkIdx` + `castPkFind`)。
- 否定條件含無效值(如 `undefined`)時,依「無效值不命中」推得之否定為全部命中,delAll 會清空全表——一律 reject。非運算子物件(`{}`)當條件值時要視為無效值,不可讓主鍵條件消失(初版即因此 `delAll({id:{}})` 刪光全表)。
- Jet 精度怪癖:DOUBLE `0.30000000000000004`、CURRENCY `1.23456`(存 1.2346)之 SELECT/DELETE 會命中,UPDATE 影響 0 列 → save 重試 3 次後 ok:0。
- WHERE 不轉型:文字欄 `= 123`、數值欄 `= '12'`,只要表非空即 3464(空表不報錯)——同一呼叫之結果隨表是否為空而變,寫測試時表內須先有非數字列。
- INSERT 轉型:數字存入文字欄為字串(非指數形式者同 `String(v)`;1e21→`1000000000000000000000`、1e-7→`0.0000001`、1.5e300→`1.5E+300`);數字字串存入數值欄為數字(`'012'`→12、`'1e1'`→10、`'12.4'`→12);LONG 欄之非整數四捨六入五成雙(12.5→12、11.5→12);LONG 溢位報 3464。
- **超過 255 字元之字面值**:SELECT 與 DELETE 截至 255 字元比對(會命中/刪除以其前 255 字元為鍵之他列),UPDATE 不截;≤255 而超過欄寬者不截(不命中)、INSERT 報 3163。
- 字串含 `\u0000`:SQL 文字於 NUL 被截斷,報 3075 語法錯誤(無注入風險,恆為未結束之字串)。孤立代理字元進 exe 後被併為 U+FFFD。
- **長字串之 `IN` 與 `=` 不等價**(2026-10-16 獨立複審 r4/r5/r7):255 個 `é`、`'`、`-`、`中`、`カ` 等組成之主鍵,`=` 命中而 `IN` 回 0 列(`-` 於某些表狀態自 127 字元起);常見混合字串至 255 未重現。主鍵定位一律用 `=`,不依 `IN` 之結果下結論。
- 自審之表必有洞:本次自認完整之矩陣,經子代理複審仍找出 6 組漏格(`IN`≠`=`、`$ne`/`$nin` 誤刪、包裝物件/BigInt、GUID 欄、孤立代理、opt.pk 改名時 importModels 寫死 `'id'`)。審計類任務務必派複審,並要求附探測輸出。實作後之三方外審(opus/sol/muse)再找出 26 條全屬實者,其中 7 條為會誤刪之高風險格——**矩陣產生器之「刻意允許」不可一律放行,須斷言「delAll 不刪任何列」**。
- 外審品質(本輪):opus 擅長找根因與提出設計轉向;sol 條目少而準、附腳本;muse 條目多且附探測,但嚴重度常自評偏低。三者互補,皆無誤報。
- `src/importModels.mjs:52`、`:95` 寫死 `'id'`(2026-10-16 審計時之現況):opt.pk 為他名且 model 另有非主鍵欄 `id` 時會改寫 model 檔——測此情境時一律先把 model 複製到暫存夾再當 fdModels。
- wsemi:`isnum` 對 ±Infinity 為 true;`isestr(new String(''))` 為 true(依 toString 標籤收包裝物件、以 `v !== ''` 判空);主鍵有效性勿直接用這兩者。

## 探測方法

- 探測腳本放 `./tmp/audit01/probe/`,以 `src/jet.mjs` 之 `jetOpen().create()` + `execute(DDL)` 建新 mdb(存值以原生 SQL 精確控制),再以 `src/WOrmMdb.mjs` 呼叫;每格於種子庫之新複本執行並以原生 SQL 讀全表比對前後,才能看出「改到/刪到他列」。
- 探測用 model 放 `./tmp/audit01/models/`,須含 `'id': {` 與 `primaryKey: true,` 兩行,`src/importModels.mjs` 才不會改寫該檔。
- `jet.mjs` 之暫存檔落 cwd 之 `./src/`,每次呼叫後自刪;探測完以 `git status --short` 確認無殘留(中介檔位置屬使用者保留議題,勿改)。
- 撞鍵核對耗時(p4):單次 exe 送 N 個 query 指令,每個約 2ms(各寫一個 jsonl);批次 `IN`(每批 200)5000 筆約 0.3 秒。逐筆查詢不可作為常態路徑。
- 笛卡兒表以 `probe/gen-matrix.mjs` 由 jsonl 自動產生並自動判定現況是否符合應然,避免手填漏格。

## 實作期(2026-10-16 run03)

- sequelize 6 之 `DataTypes.DOUBLE.key` 為 `'DOUBLE PRECISION'`(非 `'DOUBLE'`),另有 `NUMBER`;依 `type.key` 分類型別時以實查為準(`node -e` 印各型別之 key)。
- 效能基準(5000 筆,三輪):delAll 帶條件逐筆 `=` 約 1.7–2.3 秒(修前 `IN` 約 0.5 秒);insert 撞鍵之逐筆 `=` 補問每筆約 2–3 ms;select 全表約 0.25 秒不變。
- 條件轉譯(`getUseFind`)未修之風險:`{欄:{$not:{$gt:x}}}` 回傳全部列(delAll 會刪光全表);`$regex` 之 `%`/`_` 為萬用字元;`$nin` 含 null 恆空;含 `length` 鍵之條件 reject。待 w-orm-reladb 之 `cvFind` 定案後移植。
- 測試資產只重產新檔:`node toolg/genTestMdbAssets.mjs worm_pk_def.mdb`(不帶參數會重產全部、改動受版控之二進位資產)。
- 範例比對:`node tmp/audit01/probe/cmp-examples.mjs`(註解中之 `...` 截斷、`{random id}` 須正規化);範例會覆寫根目錄 `worm.mdb`,收尾以 `git show HEAD:worm.mdb > worm.mdb` 還原。
- 外審派工:`tmp/review03/dispatch.mjs <opus|sol|muse> <probe|run>`;同時派多人時禁止其跑 npm test(各測試檔之暫存夾固定,會互撞)。

## 條件轉譯移植 cvFind(2026-10-16 排程第 32 項,審計 run01 + 實作 run02)

- **只換轉譯函數不夠**:`castPkFind` 先於轉譯執行,其 lodash `each` 走訪(具數值 `length` 之物件當陣列樣、丟 Symbol 鍵)與 delAll 入口之 `size(keys(find))===0` 同樣會把條件變 `{}` 而全刪;審計之原型 p1(只換 getUseFind)仍有 18 格不符、11 格誤刪。凡在 cvFind 之前碰 find 之處都要用 `Reflect.ownKeys` 與一般物件判定。
- cvFind **不可傳 `ctx.pk`**(會在 sqlite NOCASE 判主鍵等值,違反 R-PK-00);主鍵條件由 castPkFind 改寫為序號欄之 `$in`/`$nin`,序號欄須在記憶體 model 之 attrs 內(嚴格鍵)。
- reladb 1.1.9 之嚴格鍵以「記憶體 model 之 rawAttributes」為準:近似鍵(`ID`、`'id '`)、`rowid`、點路徑一律 reject,與 castPkFind 之 `k === pk` 一致;1.0.35 時 `{ID:…}` 經 sqlite 不分大小寫之欄名解析命中(繞過 Jet 判定)。
- **兩份 sequelize**:以巢狀副本載入 cvFind(`tmp/run02/twocopy/probe.mjs`)時,literal/where 物件不被執行端 sequelize 辨識,`$in:[]`、`$nin:[]`、`{}` 子式、`$regex` reject `Invalid value Literal`(fail-closed,不誤刪);型別分類有 `type.key` 補判而不受影響。**探測腳本放在夾具資料夾內時,`import 'w-orm-reladb/...'` 會先解析到夾具之 node_modules**——單份對照組須以絕對路徑載入 repo 之 `node_modules`,否則兩組都是副本(本次首跑即誤判單份也 reject)。
- **呼叫端條件之讀取須「每個值只讀一次」且單趟**:原型 p3 之「castPkFind 兩趟(先收集、再改寫)」在兩趟讀值不一時(覆寫 `valueOf` 之包裝物件、`getPrototypeOf` 會變之 Proxy、未入快照之深層 getter)第二趟之值查無序號,`$ne`/`$nin` 消失而 delAll 刪光全表(run02 外審 opus、sol 與自審共 3 條同根)。已改為單趟走訪 + 佔位陣列(`fillPkSlots`);快照另以內建方法重建 Date/RegExp(上游 cvFind 先檢後讀)。日後凡新增「讀 find 兩次」之處,一律視為缺陷。
- 快照必須記錄已走訪之物件:不記錄則 `o.a=o; o.b=o` 指數展開,node 行程記憶體耗盡崩潰(非 reject)。深度上限須以 cvFind 之深度計法換算(cvFind 對 `$and` 每層計 1,快照計 2)。
- model 與 Jet 表欄名不一致(model 過時、大小寫不同)時,記憶體過濾表該欄恆 NULL,`{欄:null}` 刪光全表——過濾表只定義 Jet 列實有之欄,交嚴格鍵拒收。
- 外審派工:sol(gpt-6.1-sol)第 1 次以 `cyber_policy` 中止(提示詞含「刪光全表」「Proxy」「getter」等字眼與對抗式探測);重派時加註「功能正確性與資料一致性審查,非資安測試、不撰寫攻擊或繞過程式」即完成。muse 於 2026-10-16 晚間探測與正式派工皆無任何輸出。審查期間我又改了 src,審查者會讀到不同版本——派工後非必要不改 src,必要時於報告註明。
- 主鍵欄之範圍運算子遇 invalid/mismatch/cannot 於肯定語境必須產生「不命中」子式,不可留 `null` 給 cvFind(cvFind 對 `$gt:null` reject,1.0.35 為 `> NULL` 不命中)。
- 主鍵欄 `$not` 須整體取反 `NOT(A∧B)` 並遞迴(內層 `$not` 亦需 Jet 判定與否定語境檢核);1.0.35 只改寫一層且作 ¬A∧¬B,`{id:{$not:{$eq:'a',$ne:'b'}}}` 漏刪 9 列。
- 測試:5 檔 262 格(`test/unit-find-*.test.mjs`)並行約 1 分 50 秒;每格 select + delAll 新複本 + 讀回,約 1–1.5 秒。修前紅 128 格。
- 範例比對沿用 `node tmp/audit01/probe/cmp-examples.mjs`(輸出「實際 54 行、預期 44 行」但 SAME 為常態,修前即如此);收尾 `git show HEAD:worm.mdb > worm.mdb`。
- dist 檢查不動受版控之 `dist/`:複製 `toolg/gDistRollup.mjs` 之設定只換 `fdTar` 到 `tmp/run02/dist-check/dist`,再以 `tmp/run02/dist-check/smoke.mjs` 載入 UMD 冒煙;2026-10-16 實測經 reladb 1.1.9 之 `requireModel`(createRequire)後,dist 對 js model 已可匯入(CLAUDE.md〈版本〉所載「dist 對 modelType js 無法匯入」於重建 dist 後不再成立);rollup 對 `module` 發 external 警告(reladb 帳本 R10 建議列入 external/globals),產物仍可用。

## 文件落差

- 專案 CLAUDE.md 之測試段落(`mocha --parallel --timeout 60000`、「預設納入 test/*.mjs」)與 `package.json`(`mocha --parallel "test/*.test.mjs" --timeout 180000`)不符,以 `package.json` 為準。
- 基準 `npm test`(2026-10-14):156 passing、約 35 秒;`Error: listener boom` 為 unit-event 之預期輸出。

## 系列條件白名單接線 cvOrmFind(2026-10-19 排程第 33 項批 2)

- **上游升級後的基準紅要分兩層看**:升 reladb 1.1.10/wsemi 1.9.20 後 `npm test` 171 紅(327 綠),其中 **127 紅純因 `castPkFind` 以 Symbol `Op.and` 包覆**(條件本身是合法的,如 `{id:'a'}`),其餘 44 為「原支援、今已移除」或訊息詞彙改變。以 HEAD 的 `package-lock.json` 於 `./tmp/head-base/` 重裝舊相依實跑 498 全綠 → 紅全屬上游新行為,非環境因素。
- **HEAD 對照副本作法**(不得 stash/checkout):`git archive HEAD | tar -x -C tmp/head-base` → `npm --prefix ./tmp/head-base ci`;`npm ci` 不會建置 `sqlite3` 原生綁定(測試報 `Could not locate the bindings file`),複製主 repo 的 `node_modules/sqlite3/build` 到副本即可;舊 wsemi 沒有 `_cvOrmFindCases.mjs`/`cvOrmFind.mjs`,新測試匯入它們時把這兩個檔複製進副本之 `node_modules/wsemi/src/`(HEAD 的 src 不匯入它們,不影響 HEAD 行為);副本之 `package.json` 的 test script 可改為只跑指定檔(只改副本)。探測腳本放副本內時須 `process.chdir`(測試共用層以 cwd 相對路徑取資產),`import` 則相對於腳本檔。
- **HEAD 對案例表有兩案會讓行程卡死或記憶體耗盡**:H19(共享參照指數展開)與 H20(`length` 為 4294967295 之 Proxy 陣列,HEAD 之 `snapFind` 同步迴圈)。同步迴圈 mocha 的逐案逾時無從中斷;修前紅一律 `--grep "H19|H20" --invert` 略去,並以 `quiet-run --timeout` 或 `taskkill /T` 終止自己啟動者。同理,變異 M1(拿掉 cvOrmFind)時 H19 令 worker OOM 崩潰,屬預期之紅。
- **修前紅數**:案例表 255 案對 HEAD(含舊相依)實跑,行為性紅 58 + 略去未跑之 H19、H20(HEAD 必紅)= 60,另有僅訊息詞彙不同 84;60 之中 33 屬審計 191 形狀(審計 mdb 之 R+/R- 31 全在內,另 H06、H07 審計未測)、27 屬 wsemi 增補案(含 H19、H20)。審計值 31(+3 未測)與實測差異來自 wsemi 增補案與未測格。
- **變異與等價變異**:`maxList` 在 mdb 之呼叫改 1000 時,其後 reladb `cvFind` 內之 `chkFindShape`(999)仍以同訊息拒收,故黑箱看不出差別,只差「已讀表才拒」之時序——以「不存在之 mdb 路徑 + 超限 find 仍回 invalid find」補案後才轉紅(同法用於 `maxIn`)。`inited` 旗標(壞 find 不 `closeSequelize`)無可觀察後果(共用之 `sequelize` 僅用於匯入 model 取 `rawAttributes`),屬等價變異,不以測試強制。**「delAll 全刪判定讀複本」要用 `ownKeys` 於檢核後回空之 Proxy 才鑑別得出**;其「第幾次讀」以先校準 `cvOrmFind` 自己讀幾次為準,不依賴呼叫堆疊檔名。
- **案例表測試資料的 Jet 細節**:`flag: null/undefined` 於 YESNO 欄存為 false(故案例 N08 的 mdb 覆寫含 a4、a6);`d` 以本地時間分量寫入(`#yyyy-mm-dd hh:mm:ss#`),與 `getCmd.mjs` 一致;案例表資產 `worm_wl_def.mdb`(表 `tw`)只重產新檔:`node toolg/genTestMdbAssets.mjs worm_wl_def.mdb`。
- **效能**:案例表 255 案分 4 檔並行約 30 秒(新碼,壞 find 在讀表前即 reject);全套 814 案約 4 分 09 秒。
- **工具陷阱**:Bash 工具內 `node -e "…"` 的雙引號字串若含反引號會被 shell 當成命令替換而悄悄吃掉文字(帳本因此被寫壞一次,以 Write 寫腳本檔再執行修復);凡含反引號或 `$` 的多行文字一律先用 Write 存檔再由腳本讀入。
- **外審(opus、sol、beam)找出的 castPkFind/findAll 缺口,日後改寫條件樹時先對照**:①改寫後的樹會被 reladb `cvFind` 內的 `chkFindShape` **再檢核一次**,凡改寫產出空子式 `{}`、Symbol 鍵、額外巢狀層,都會讓「入口合法」的 find 被拒——序號條件須**併入同一物件**(`{...其餘, [wi]: {$in|$nin}}`),不可額外包 `$and`(每層含主鍵者深度被放大一倍,原深度 16 即被拒);邏輯陣列元素若主鍵條件全化簡掉,要補恆真條件 `{wi:{$nin:[-1]}}` 而非留 `{}`;②`maxIn` 只限單一陣列,分散於 `$or`/`$and` 內的主鍵 `$in` 總量須另設上限(逐筆交 Jet,98000 值阻塞 328 秒);③`opt.pk` 除為 model 屬性外須為 Jet 列實有之欄(model `id`/資料表 `ID`),否則主鍵條件被化簡成「查無」,select 漏查而 delAll 拒收;④castPkFind 自己丟的錯也要用 `invalid find: … at [路徑]` 格式且不回顯值;⑤測試用的「第 N 次讀取回不同值」Proxy,N 以先校準 `cvOrmFind` 自己讀幾次為準,不要用 `Error.stack` 檔名判斷。
- **外審派工**:審查者用 repo 副本(`./tmp/review/<名>/`,`node_modules` 以連接點引用本 repo 的),sol 之副本先把註解/測試標題中「繞過、攻擊、注入、惡意、刪光全表」等字眼中性化;`claude -p` 與 `opencode run` 無串流輸出,「10 分鐘無輸出」改以副本內檔案活動、session 紀錄 mtime、子行程是否在跑 `connMDB.exe` 判定。

## 日期範圍、主鍵範圍界限、sequelize 生命週期(2026-10-20 排程第 83、79 項;審計 run01 + 修正 run02)

- **Jet DATETIME 是「本地牆上時間」,範圍本地年 100–9999**:年 0–99 無法表示,Jet 依兩位數年規則靜默改年且不報錯(補零無效;年 1–12 還會被讀成月-日-年,`#0001-06-15#`→2015-01-06);年 ≥10000 報語法錯。Date 寫入非 DATE 欄(STRING)亦被改年。字串與 `#…#` 常值皆不收小數秒(3464/3075)——毫秒不可能經 SQL 文字寫入。`select` 回傳之 `yyyy-MM-ddTHH:mm:ss` 因含 `T` 無法原樣寫回(3464),須正規化為 `yyyy-MM-dd HH:mm:ss`。
- **範圍判定用本地年,不用 UTC 年**:對真 Jet 7 時區 × 23 瞬間 = 161 格,本地年規則 0 誤判,UTC 年 100–9999 誤判 25、UTC 年 1–9999(reladb 1.1.11)誤判 64。V8 對古早日期用 LMT 偏移(Taipei +8:06),存值與判定同源故自洽;測試邊界瞬間選「偏移正負號決定」者(如 UTC 0100-01-01T00:00:00Z),避免倚賴 LMT 分秒。
- **測試的 Jet 對照組作法**:不凍結期望表,而是每格先以不經受測碼的原生 SQL 常值寫進真 Jet、讀回判「存值是否等於寫入之本地分量」,再要求 `inJetDate` 同判(`test/unit-date-range.test.mjs`);引擎行為變了測試自動跟著變。
- **時區切換**:命令列 `TZ=Asia/Taipei node …` 在本機 Windows 只有 `UTC` 有效,須在程序內賦 `process.env.TZ`(`test/tools/withTz.mjs`,finally 還原——`mocha --parallel` 同一 worker 會續跑其他檔,時區不還原會污染其後測試)。
- **V8 `new Date('2026-02-30T00:00:00Z')` 不報無效而進位為 3/2**,`T24:00:00Z` 亦被收;含 `Z`/偏移之 ISO 字串須先自行以算術驗曆法(月日時分秒、閏年)再交 Date。
- **O1 往返之設計取捨**:無時區字串**不經 Date** 而正規化為牆上時間字串,因經 Date 會使夏令跳過之時刻(美西 2026-03-08T02:30:00)被進位為 03:30,往返後值改變;含偏移者才經 Date(瞬間無歧義)。
- **「檢查之值即使用之值」連 Date 子類別也要顧**:`escVal` 若讀實例方法,覆寫 `getFullYear` 之子類別可使預檢通過而序列化為 `#50-…#`。預檢與 `escVal` 一律用 `Date.prototype` 方法,預檢通過者換成一般 Date。
- **F-X1(LF8)**:記憶體 sqlite 以 UTC 文字存 DATE,負偏移時區下 Jet 本地年 9999 末幾小時之列換算為 UTC 年 10000(`10000-01-01 …` 字典序小於 `2026-…`),`delAll({d:{$lt:今日}})` 會誤刪「永不過期」哨兵列;正偏移與 UTC 不受影響。根因在 reladb。**已解(第 87 項 B4,2026-10-21):reladb 1.1.14 的 `dateNoTz:'floating'` + `toFloating`,見下〈第 87 項 B4 教訓〉。**
- **Sequelize 實例計數技巧**:建構子內 `this.connectionManager = …` 是指派,於 `Sequelize.prototype` 定義 `connectionManager` 之 setter 即可計「建立數」(含 model 匯入失敗而未呼叫 `define` 者);`sqlite3.Database` 以 Proxy 包建構子、攔 `prototype.close` 計連線開關。LW7 之漏關者僅為 Sequelize 物件(主實例從未查詢,故從未開連線),不是連線/行程洩漏。
- **主鍵範圍界限**:對「等值」而言不可能等於主鍵欄之值即不命中(正確),對「範圍」則否——`k > 2.5` 的正解是 3,4,5。把非 ok 界限改寫為恆假,於 `$and`/`$or`/同物件多運算子下會放大成整批錯誤集合(不會過刪,因白名單已無 `$not`/`$nor`)。
- **探測夾具**:`tmp/run01/lib.mjs` 把 cwd 切到 `tmp/run01/work/`(內含 `src/connMDB.exe` 副本),令 `jet.mjs` 的中介檔不落 repo 的 `src/`;`MDB_SRC` 環境變數可指向原型副本的 `src/`。探測腳本崩潰時會在該處留 `_*_in.json` 殘檔,收尾前清掉。

## run02 實作期教訓(2026-10-20,第 83、79 項修正)

- **字串守門不要列舉文法,掃數字串**:Jet 接受的日期字串寫法極多(`0050年6月15日`、`June 15, 0050`、`15-Jun-0050`、`0050-06`、`15.06.0050`〔被讀成時間 1899-12-30T15:06:50〕、全形數字…,外審 opus 對真 Jet 實測 47 種),凡含零填充小年份(獨立數字串達 3 位以上而值 <100)者皆被靜默改年或錯讀。以兩條正規式(年在前/在後)列舉的初版被外審一次找出 17 種漏網;改為「先 NFKC,掃 `/\d+/g`,任一長度 ≥3 且值 <100 即拒」一條規則涵蓋。純數字串(`45000`、`20260615`、`007`)Jet 本即報 3464,拒或不拒無差。兩位數年(`6/15/50`)為 Jet 文件化寫法,不拒。真 Jet 探測腳本 `tmp/run02/s1-strings.mjs`。
- **預檢與序列化的分類必須同源**:`escVal` 對非 Date 物件以 `String(v)` 當字串寫出(`isstr(new String(..))` 為真亦然),預檢若只認 `typeof 'string'`,`new String('0050-06-15')`、`['0050-06-15']`、自訂 `toString` 物件即漏網。預檢取 `String(x)` 一次、判定、並**以該原始字串取代原值**。
- **測試期望不可倚賴主機時區資料**:Asia/Manila、Pacific/Guam 等的早年 LMT 為負偏移逾 12 小時(Manila UTC−15:56),`0100-01-01T12:00:00Z` 在其本地年為 99;寫「任何時區本地年皆為 100」的 ISO 案例在 Manila 主機會紅(外審 sol 以 Manila 啟動檔跑出)。ISO 邊界案改用年中日期(`0100-06-15T12:00:00Z`),邊界瞬間只在 Taipei/LA 等偏移正負號明確的時區硬編期望,其餘取執行時本地年;Jet 對照組由真 Jet 判定而不倚賴 ICU 版本。`withTz` 遇無效時區名稱(V8 靜默落到 `Etc/Unknown`=UTC)須拋錯,否則該時區案例以 UTC 行為全綠而不自知;還原須賦回「呼叫前」時區(取自 `Intl`),`delete process.env.TZ` 不會令 V8 重載。
- **外審找到的測試漏洞形狀(都經變異實證存活後補)**:①`save` 之 `autoInsert:false` 案若 seed 了該主鍵,實走更新路徑,從未踏入「未命中不寫入」分支(sol 與 opus、argon 三家獨立找到:預檢略過 cannot 主鍵/未命中之列的變異存活);②ISO 字串之「本地年 ≠ UTC 年」須在邊界瞬間以不同時區對照(Taipei 寫 `0099-12-31T20:00:00Z` 成功、LA 寫 `0100-01-01T05:00:00Z` 拒收);③並行 close 測試排在依序 close 之後即已是空操作,須「首次即並行」才鑑別旗標置位時機;④生命週期測試只對 `select` 驗外部實例,其餘六入口的 finally 條件被改為恆關閉時全綠——七入口各測。
- **磁碟滿會把 src 截成 0 位元組**:變異測試工具原以 `writeFileSync` 直接覆寫 src,磁碟滿(本機另有程序耗盡 C: 空間,與本專案無關)時 `WOrmMdb.mjs` 被截成 0 byte,幸有開跑前的備份可還原。工具改為「寫同夾暫存檔再 rename」「開跑前與每項前檢查剩餘空間」「還原失敗重試」;**變異測試前先 `df`**。審查者的 `review-out/` 副本也可能膨脹(外審刪除前曾佔去約 1 GB),收回後先清。
- **外審額度**:sol(gpt-6.1-sol)於本機在約 12 分鐘處回 `usage_limit_exceeded`(`codex exec` 離開碼 1,`result.json` 只留 500 字元、stderr 被截,要看原因須讀 `~/.codex/sessions/…/rollout-*.jsonl` 末段的 `task_complete.error`);其未完成的 `review-out/` 仍有可用的探測與變異(`mutant-save` 即抓到上述 save 漏洞)。Argon 補派可用(probe 35 秒)。派 agy 時提示詞內的路徑須與 `addDirs`/cwd 一致(第一次探測因提示詞指到別人的 W 而逾時)。
- **工具陷阱再犯**:`node -e "…"` 雙引號內含反引號、`${}`、反斜線時被 shell 吃掉(又寫壞一次變異清單與一次探測腳本);含這些字元的內容一律用 Write/Edit 工具。`cat > file <<EOF` 亦違反全域規範(檔案 I/O 用 Write/Edit)。

## 字串良構檢核(2026-10-21 排程第 66 項批 2;wsemi 1.9.24 `chkOrmStr`/`chkOrmData`/`_cvOrmStrCases`)

- **HEAD 實測(`tmp/head-probe.mjs`)**:孤立代理之寫入**值**(含陣列內元素、經 `String(v)` 轉成文字者)被橋接改寫為 U+FFFD 後靜默存入(讀回 `'a�'`);資料**鍵名**(含非欄位)被忽略;主鍵含 NUL/孤立代理 `insert` 早已 reject(訊息回顯主鍵)、`save`(autoInsert 開)`ok:0`(回顯)、`save`(`autoInsert:false`)與 `del` 靜默 `ok:1`、`selectByPk` `null`。故 D5 的矯正對象是 `del` 與 `save` 的 `autoInsert:false`。
- **Jet 排序規則弱相等(D4)實測(`tmp/collation-probe.mjs`)**:先 `insert` `'a'`,則 `selectByPk('a'+emoji)`、`selectByPk('a'+U+FFFD)`、`selectByPk('A')`、`selectByPk('a ')` 皆命中 `'a'`;`insert('a'+emoji)` 視為已存在(`nInserted:0`);`del({id:'a'+emoji})` 刪掉 `'a'`。案例表對 mdb 全數通過(其良構形態之 id 彼此不相等),審計之 48 格弱相等不在案例表內。
- **`normPk` 不可改回 `invalid`**:`procPk` 對 `invalid` 在 `autoGenPk:true` 時補自動產生之主鍵,孤立代理主鍵會被 UUID 取代而「成功寫入」(reladb 1f 的陷阱,其 `normPk` 一向回 `invalid`)。本套件 `normPk` 回 `cannot`(附 `why`),天然不踩,另以 `chkWf` 先行檢出並有專測。
- **案例表資產要點**:`name` 欄須 MEMO(案例表有 1000 碼元長字串之值,TEXT(255) 會被 Jet 擋);model 之 `name` 用 `DataTypes.TEXT`。案例表夾具 `mk(id, extra)` 之 `id` 為字串主鍵、`name` 為字串欄。2367 工作(1305 × 三輪)對真 Jet 約 5 分鐘(6 檔 `--parallel`,每案約 0.6–0.8 秒)。
- **`lodash cloneDeep` 兩個性質**:①對**自有**存取器逐一讀取並複製為資料屬性(故案例表 `toctou` 的自有 getter 在 `snap` 複製當下即被讀一次,後續皆為資料屬性);②保留原型,**繼承**之存取器不被呼叫也不被複製。③自有屬性若遮蔽原型鏈上**僅有 getter** 之存取器,`cloneDeep` 逐一指派時拋 `Cannot set property id of #<Object> which has only a getter`——故 `chkWf` 須先複製檢核複本、再把主鍵固定為自有資料屬性(順序反了即拋)。
- **`pmQueue` 於執行前 `delay`**:`useStable:true`(預設)時各函數在佇列輪到時才執行,函數內的 `cloneDeep(data)` 因此晚於呼叫,呼叫端呼叫後立即改動原數據會改變實際寫入值(HEAD 即有);複製移到註冊處 `snap`。案例表 `toctou:*:mutate-after-call` 暴露(reladb 1f 先發現)。
- **「檢核先於初始化」的可觀察性**:`initAdodb()` 不 throw(匯入失敗存入 `si.err`,於 `try` 內才 throw),故只把預檢移到初始化之前/之後,在 `cl` 指向不存在 model 時才會有不同結果(壞輸入報 `invalid id/data`、良構輸入報 model 錯誤);測試與變異皆以此鑑別。`save`/`del` 全數不合格時略過初始化需以 `nPend` 同時守住初始化與主體,變異只改其一為等價變異(`si.err` 不被讀),須兩處一起改。
- **`escVal` 是字串進入 SQL 文字之唯一出口**:在此加最後防線(孤立代理拋 `invalid data: string contains lone surrogate`,不檢 NUL)即涵蓋所有來源(欄位值、`String(v)` 型別轉換、自訂 `toString`、存取器於檢核後才回傳壞值),`insert`/`insertBulk` 之 SQL 於 `jet.run` 前全數產出,故拋錯時不寫任何一筆。非字串值先 `String(v)` 成原始字串再檢與跳脫(包裝物件勿直接餵 `chkOrmStr`,會回 `not a string`)。
- **修前紅對照作法**:`git archive HEAD src models package.json` 解到 `tmp/head66/`,新測試複製到 `tmp/head66/test/`,以 `node tmp/run-red.mjs`(子行程 cwd 設為 `tmp/head66`)跑 mocha;`node_modules` 由父層(repo 根)自然解析,不需連接點。測試的 `pk` 匯入宜用 `import * as pk` 命名空間,才不致因 HEAD 缺匯出而整檔載入失敗(損失逐案資訊)。
- **mocha `--parallel` 搭 `--reporter json --reporter-option output=檔`** 可取機器可讀結果供分類;案例斷言訊息加 `[行為]`/`[詞彙]`/`[狀態]`/`[事件]` 標籤,即可在修前紅時把「HEAD 行為不同」與「僅訊息詞彙不同」分開統計。
- **變異工具**:`tmp/mut/run-mut.mjs`(複本作業不動 repo src;階段 1 跑 `unit-wellformed`,存活者階段 2 跑案例表 `--grep`;`fnRange`/`once` 確保置換恰一處、不是 no-op)。**變異清單內含反引號/`${}` 的置換字串一律寫在 .mjs(Write 工具),不用 `node -e`。**
- **「改成複製」本身要過輸入型別表(sol 第 2 輪找出 9 條,高 6)**:把「檢核後再讀」改成呼叫當下攤平後,新引入的洞全在輸入型別:①外層批次是 `Array` 子類別且自訂 `Symbol.species` 時,`d.map(flatRow)` 的結果型別由子類別決定(實測變 `Uint8Array`、整批靜默零筆)——外層批次一律索引迴圈建普通陣列;②陣列子類別的列(`class Row extends Array { get id(){…} }`)被「陣列原樣返回」略過,主鍵存取器仍重讀——`cloneDeep` 對陣列只複製索引(自有的額外屬性即丟),故子類別的欄位值只能來自原型上的 getter,須同樣攤平;③Map/Set/Date 等內建容器攤平後只剩一般屬性(`Map.prototype.size` 是存取器還會多出一欄),`chkOrmData` 看不到容器內容而繞過檢核,且單一 Map 輸入從「無資料」變「寫一筆空列」——以 `Object.prototype.toString` 標籤排除內建容器;④原型上的陣列/物件與 getter 回傳物件沒有被 `cloneDeep`(它只複製自有屬性),攤平時要自己深複製;⑤`opt` 以 `for in` 複製漏掉不可列舉選項與類別 getter(HEAD 的一般屬性存取讀得到),要補本套件讀取的選項名稱(`url db cl fdModels modelType logging pk autoGenPk useStable storage useEncryption`);⑥複製時 `o[k] = v[k]` 遇鍵名 `__proto__`(如 `JSON.parse` 得到的自有資料屬性)會改原型而保留可變 getter——一律 `defineProperty`。教訓:任何「把讀取點換成複製步驟」的修正,先列輸入型別表(純物件/類別實例/Object.create/陣列子類別/內建容器/Proxy/凍結/存取器拋錯)與選項讀取表(可列舉/不可列舉/繼承/`__proto__`/非物件)再改。
- **延後拋出的存取器**:攤平時某個與 model 無關的 getter 拋錯不應讓整次呼叫失敗(HEAD 只在該欄位被讀時才拋),改成在攤平列上定義「重拋同一錯誤」的不可列舉存取器——只有 `pickCols` 等真的讀該欄才拋,`chkOrmData` 因不可列舉而不走訪。
- **工具陷阱(本節寫帳本時又犯一次)**:在 Bash 的 `node -e "…"` 內寫含反引號的文字,反引號與其內容被 shell 當成命令替換吃掉(檔案被寫壞,以 Write 重寫修復);另在 JS 樣板字串或 `node -e` 內寫 `\\b`(想要正規式字邊界)會變成真的退格字元 0x08(測試檔內肉眼看不出、`grep` 亦不顯示),使正規式永遠不匹配,以 Edit 工具直接改檔並用 `grep -c` 查控制字元驗證。**凡含反引號、`$`、反斜線的內容一律用 Write/Edit 工具,不經 shell 字串。**
- **負載下的既有不穩**:`mocha --parallel` 全套在機器同時有外審行程(codex、opencode)與變異測試在跑時,`unit-concurrency` / `unit-instance-lifecycle` 偶發 Jet 3031 `Not a valid password.`(已記載之 LD4)並連帶令 R-LIFE 計數測試差 1;單獨重跑三次皆綠。**收尾全套請在無其他重負載時跑**。

## 第 87 項 B4 教訓(2026-10-21,非主鍵日期條件改用浮動時間)

- **現有全套對此缺陷零偵測力**:負偏移時區啟動(`TZ=PST8PDT`)全套仍全綠,因為既有種子日期都是 2020–2099 的普通時刻。要偵測須有(a)哨兵 `9999-12-31 23:59:59`、(b)夏令跳過/重疊時刻、(c)**時區自證**(`tzProof`:本地 getter 偏移 = ICU 偏移,負偏移者哨兵之 UTC 年為 10000),缺 (c) 則時區名打錯時靜默落到 UTC 而全綠。修前實測:LA/New_York 106/156 格錯、Sao_Paulo/Etc/GMT+12 102/156、柏林 16/156、Lord Howe 14/156;UTC+ 無夏令四區 0 錯。
- **資料側與條件側必須同進同退**:只改 `dateNoTz:'floating'` 而資料列不經 `toFloating`(混用)比修前更糟(無聲誤命中);兩側的 DATE 欄認定同用 reladb 的 `getColKind`(不用 `instanceof Sequelize.DATE`:兩份 sequelize 並存時 `instanceof` 為假,`getColKind` 有 `type.key` 後備;`tmp/twocopy.mjs` 以 reladb 帶巢狀 sequelize 副本實測 41/41 通過)。
- **轉換失敗必須整批拒收**:回填原值(回到非浮動空間)與代入 NULL(`IS NULL` 命中、範圍不命中)兩種「寬容」寫法皆為變異並被測試殺死;`null`/`undefined` 不動;訊息不回顯值。
- **變異/基準工具紀律**:①在背景跑「HEAD 基準全套」的同時編輯 `src/` 會污染基準(worker 於各檔載入時才 import),須殺掉重來,並清掉被殺行程留下的 `src/_*_in.json` 與 `test/temp-*`;「HEAD 基準」改由變異 `HEAD`(整檔還原)取得。②變異副本放 repo 的 `./tmp/mut/<名>/` 下,Node 向上解析即借用 repo 的 `node_modules`,不需複製或連接點。③`npm install <pkg>@^x` 的副作用:`package-lock.json` 自身 `version` 被同步成 `package.json` 之版本、`package.json` 檔尾換行被補上,皆須還原(版本不在本任務範圍)。
- **工具陷阱再犯**:建腳本用 `cat > file <<EOF` 又違反全域規範(§8.1),一律 Write 工具。

## mdb-run01 教訓(2026-10-28,第 153 項:診斷輸出之單一出口與預設安全,R-DIAG)

- **先量舊輸出再設計**:以 HEAD 副本(`git archive HEAD src | tar -x -C ./tmp/mdb-run01/head`)跑探測 `tmp/mdb-run01/probe-head.mjs`(`logging:true` + 兩個拋錯之訂閱函數 + 一次記憶體過濾之 select)得到舊輸出的真實形態:訂閱函數拋錯為 `console.log(err)`(**單一 Error 引數**);`logging:true` 為 stderr 一則 `SEQUELIZE0002` deprecation 警告加每個敘述一行 `console.log('Executing (default): <SQL>')`(**單一字串引數**),SQL 含記憶體過濾表之全表各列 INSERT 欄位值與 WHERE 條件值。寫入類函數(insert/save/del…)送 Jet 之語句不經 sequelize,不會產生紀錄。`logDetail` 之「還原舊格式」即是這兩種單引數(bare),以測試與 HEAD 副本同跑驗證相同。
- **移植 reladb 之 getDiag 時要核對差異而非照抄**:mdb 無 `PRAGMA key`(不用 sqlcipher),刪該遮罩規則;Jet 錯誤多以**字串** reject(`getBriefErr` 只列 `string`);reladb 之 `invalid dialect in opt.url` 前綴固定不回顯 dialect,而 mdb 之 `dialect[${dialect}] is not mdb` 會回顯第一個 `://` 之前之文字,**無 `://` 時即整串 opt.url(可能只是密碼)**,`maskUrl` 管不到,須另加 `maskDialect`(HEAD 實測 url 為 `Zonly7` 時訊息為 `dialect[Zonly7] is not mdb`)。
- **選項快照之細節**:`logDetail`、`funLog` 必須加入建構時依名稱讀取之列表(`url db cl … 'logging', 'logDetail', 'funLog'…`),否則不可列舉(`defineProperty`)與類別 getter 提供之選項讀不到;但**只給一般可列舉屬性時漏列不會被發現**(`for in` 仍列舉到),變異 M21 在既有測試下存活,補「不可列舉/繼承之選項」測試才殺死。getter 拋錯之處置:本套件快照一律讀取並原樣拋出(reladb 之 `getOptLog` 把拋錯當忽略,兩者不同,移植測試時此案要改)。
- **後端錯誤訊息隨系統語系而異**:本機 Jet 回英文(`Not a valid password.`),固定預期值(golden)若含之,換語系機器必紅。比對時把非本套件自產(不以 `invalid ` 開頭)之訊息換成固定字串(`normScenario`);本套件自產訊息逐字比對。
- **同一份測試跑不同版本之 src 的接縫**:`test/tools/srcDir.mjs`(環境變數 `WORM_SRC_DIR` 指向 `./tmp/mdb-run01/head/src` 或變異副本 `./tmp/mdb-run01/mut/<id>/src`;測試以動態 import 載入,子行程繼承環境)。這使「修前紅」與「變異驗證」不需改測試檔;connMDB.exe 由 jet.mjs 依 cwd 之 `./src/` 尋找,不受影響。
- **修前紅不代表每案都紅**:對 HEAD 副本跑 `unit-diaglog-wo`,契約比對(golden)與「還原舊輸出」案在修前即應綠(它們是回歸守則,證明 `logDetail` 輸出與 HEAD 逐形相同),只有行為新增之案紅(14 案);`unit-urlerr` 20 紅 3 綠(涵蓋、合格 url、孤立代理三案本來就綠)。報告要分開寫。
- **terra 額度用盡**:08:51(UTC+8)`codex exec -m gpt-6.1-terra` 即回 `You've hit your usage limit … try again at 10:56 AM`(離開碼 1、5 秒),派工結果 `stderr` 只留前 500 字元,看不到此字樣,須手動以最小提示詞重跑才見;改派 Argon。`quota-agy` 顯示 `3p-5h` 已 100%(Claude/GPT 組),agy opus 不可用。
- **移植他套件之遮罩規則前,先核對本套件之資料形狀是否同構(本輪最重要之教訓,外審 Argon 探測出,自行實跑證實)**:reladb 之 `maskUrl` 回顯最後一個 `@` 之後的 `host[:port]`,因其連線字串必有主機;mdb 之連線字串 `mdb://帳號:密碼` **無主機**(解析只取第一個 `@` 之前為帳密、其後不被使用),帳密可含 `@`,故 `@` 之後可能是密碼後半——初版照搬時 `mdb://:MySecret@Pass123` 回顯 `mdb://***@Pass123`、`mdb://alice@corp.com:12345` 回顯 `corp.com:12345`(洩漏)。我自己的測試與第 1 輪變異驗證(32/32 殺死)都沒抓到,因為測試案例用的全是 `@db.local:1433` 形態之「合理主機」(**變異全殺不代表測試輸入涵蓋真實形態**);最終 57 變異殺死 56、存活 1(基準)。**測試輸入須含本套件之真實形態(無主機、密碼含 `@`),不只借用被移植套件之案例**;修法為 `://` 之後一律不回顯。
- **遮罩拷貝(`cpMask`)之「不執行使用端程式」須對真實之 V8 行為驗證**:`Error.stack` 於 V8 為內建存取器,**首次讀取時才以 `name` 與 `message` 格式化標頭**——若這兩者是存取器(或其值非字串而被呼叫 toString),讀 stack 即執行使用端程式(外審實測 `name-getter-executed!`)。我原測試之 Error 同時把 `stack` 也改成存取器(使內建 getter 不被讀),恰好繞過此路徑。修法:讀 stack 前沿原型鏈確認 `name`、`message` 為字串資料屬性,否則略過(stack 以 `[Getter/Setter]` 標記)。同批:Symbol **值**之描述(只處理了鍵)、包裝物件 `Object('字串')`(被複製成逐字元物件使密碼被拆開)、`errCode` 樣式放行 `E123456789`(身分證字號樣式)、Error 副本之 `message` 若為非字串物件會使 `util.inspect` 拋錯而只剩 `(unprintable)`。Proxy 之陷阱無法在純 JS 避免(dist 不得用 `util.types`),列 LDG6。
- **〔mdb-run02 已移除此機制,見〈mdb-run02 教訓〉;以下為當時紀錄〕`withDiagConsole`(轉交更舊依賴之 console.log)之設計要點**:依賴在安裝版(1.1.15)不認得第 4 引數 `diag` 而直接 `console.log`,若只轉傳 `diag` 則該路徑預設不安全且測試只能 skip;改為呼叫期間暫時替換 `console.log` 轉交 `diag`,須處理:①`diag` 自己之 console 輸出不得轉回 diag(模組層 `busy` 計數,`finally` 遞減)否則依賴 1.1.16(走 diag)時遞迴;②`finally` 一律還原;③只適用同步函數。變異 M39/M43/M44(放行判定與計數)與 M42(還原)皆以純函數測試殺死。以 reladb 1.1.16 原始碼副本(`tmp/mdb-run01/reladb116/`)實跑 `probe-reladb116.mjs` 確認新舊兩路皆正確。
- **外審 Flash 三輪之收穫(同一審查者連審三輪,每輪對修正後之現況再找,皆有屬實之新發現)**:第 2 輪抓到 `busy` 只涵蓋 console 路徑(`funLog` 內呼叫 `console.log` 於 `withDiagConsole` 期間無窮遞迴)、`getDiag` 對未規範化選項靜默、陣列擴充鍵不遮罩(**我在 Argon 探測輸出 `4c` 已看到 `S3cretPw: 'val'` 未遮罩卻漏修**,教訓:探測輸出要逐行核對,不只看自己預期之那幾行)、`maskSafe` 讀 getter、`maskText` 空字串秘密、Error 類別名稱遺失;第 3 輪抓到 `label` 未遮罩(轉交依賴之單一字串 console.log 時整串即 label)、類別名稱遮罩漏一處(修第 2 輪時新增之程式未沿用同檔既有之 `maskText` 呼叫)、摘要鍵未遮罩。**教訓**:新增一條「輸出路徑」時,以 `diag` 三個輸出(label、safe、detail)× 值/鍵/描述逐格核對是否都遮罩;修一個遮罩洞時用 grep 找同檔所有 `defineProperty(r, …)`、`r[…] =` 站點。
- **外審之快照與文件同步**:第一輪 Flash 報告之 ISSUE-01(README 仍描述回顯主機)屬實但是**時序造成**——我先把檔案複製進外審副本、其後才改 README。收尾之順序應為:全部程式與文件改完 → 才複製進外審副本 → 才派工;改動後再複製再派第二輪。
- **terra 與 Argon 額度用盡之實況**:Argon 於派工後約 14 分鐘(842 秒)回 `exit 3`、stderr `Individual quota reached … Resets in 167h…`、`RESOURCE_EXHAUSTED (code 429)`,已落地之探測腳本(`out-argon-partial/`)仍有價值——把半途產物當證據讀(本輪其探測抓到上列洩漏),不因無報告而丟棄。
- **工具**:測試鎖(`quiet-run --lock`)等待可達 7 分鐘(他套件占用);變異腳本整批放在同一次 `--lock` 內執行,而非每變異各取一次。變異腳本以 `split(find).join(repl)` 替換(避免 `String.replace` 之 `$` 樣式陷阱,見 B4 run02–03 條),並以 `node --check` 排除語法錯誤之無效變異。

## mdb-run02 教訓(2026-10-28,移除 `withDiagConsole`,依賴 w-orm-reladb 升至 1.1.17,R-DIAG-05)

- **主控裁示的方向**:替換全域 `console.log` 對同程序其他程式有副作用,且只為相容舊依賴,故移除;改以依賴下限(`package.json` `^1.1.17`)為唯一防線。**轉傳 `logDetail`/`funLog` 不需另寫機制**:依賴 1.1.17 的 `genModelsByTabs(fd, tabs, opt, diag)` 第 4 引數(`genModelsByTabs.mjs:106`)就是本實例的 `diag`,`diag` 本身已承接 `logDetail`/`funLog`/遮罩,依賴之 `:37`、`:151`、`:154` 三處輸出皆經它。
- **用「行為」而非函數屬性判斷依賴是否接受 `diag`**:`genModelsByTabs(fd, tabs, opt = {}, diag = getDiag(...))` 的第 3 個參數帶預設值,`fn.length` 只算到第 2;改為傳一個 spy `diag` 並斷言它被呼叫、且 console 無輸出(`unit-diaglog`〈依賴w-orm-reladb之genModelsByTabs〉)。依賴契約測試放在不受 `isWindows()` 守衛的純函數檔,CI(ubuntu)亦會驗。
- **預設輸出含機器代碼是設計**:依賴 1.1.17 的預設 safe 為 `{ name, type[, errType, errCode] }`(例 `errCode: 'ENOENT'`)。run01 的測試因當時預設只有 label,把 `ENOENT`/`EINVAL` 列為「預設輸出不得出現」,對新依賴即誤判;改為禁止路徑與錯誤文字(`no such file`、`open`、檔名),放行符合 `^E[A-Z]+$` 的 `errCode`。**測試的禁止詞要從「什麼算個資」推出,不從某版本的當時輸出推出。**
- **「不替換全域 console」的測試分兩層**:①行為層——在 `console` 上以 accessor 監看對 `log` 的賦值(`trapConsoleLog`),三條管道(預設、logDetail、funLog)呼叫 `genModelsByTabs` 期間賦值數須為 0、呼叫前後與 `funLog` 內所見的 `console.log` 為同一函數;②靜態層——掃 `src/` 去除註解後無對 `console` 之賦值或 `defineProperty/assign/setPrototypeOf/set(console…)`。accessor 監看躲不過 `Object.defineProperty(console, 'log', …)`(會把監看者本身換掉),故兩層互補;變異 M04(賦值)兩層皆殺,M05(defineProperty)只有靜態層殺。
- **修前紅有兩個軸**:(a) 舊 `src` + 新依賴(`WORM_SRC_DIR` 指向 `tmp/mdb-run02/src-before`)→ 「不替換」兩案紅;(b) 新 `src` + 舊依賴(`npm i w-orm-reladb@1.1.15 --no-save` 暫換 `node_modules`,實跑後以 `npm i w-orm-reladb@1.1.17` 復原)→ 8 案紅,實測舊依賴下預設、logDetail、funLog 三管道全部直接 `console.log` 路徑與錯誤文字,`funLog` 一筆也收不到。`--no-save` 不動 `package.json`/鎖檔。
- **變異 M08 存活的處置**:`diag` 外層 `try/catch`(R-DIAG-07「任何內部拋錯皆不外洩」)在 run01 時之測試無從觸及——`emit` 內各步已各自 `try/catch`,從外部餵不出會使外層拋錯的輸入。改以「建構 `diag` 後令傳入的秘密陣列之 `Symbol.iterator` 改為拋錯」製造內部拋錯(`maskText` 走訪秘密時觸發),斷言呼叫不拋、該次無輸出、移除破壞後照常輸出。**存活變異先分「等價」與「測試觸及不到」**:判定為等價前先找得出觸發路徑嗎?找得到就補測試而不是記為等價。
- **`npm i` 的副作用須還原**(同 B4 run02 條):`package-lock.json` 自身 `version`(兩處)被同步成 `package.json` 之版本、`package.json` 檔尾換行被補上;依賴範圍與鎖定版本之變更保留。
- **移除一個機制時,連帶的測試要逐案判斷**:run01 為 `withDiagConsole` 寫的 4 案(轉交、遞迴、busy 歸零、引數形態)屬機制本身,刪;其中仍有獨立價值者改寫為直接對 `diag` 的案(funLog 內呼叫 `console.log` 只被呼叫一次且無遞迴、`diag` 在 funLog/getDetail/console 拋錯後仍照常輸出、label 於三管道皆遮罩),不為「少改」而留下依附已刪機制的測試。

## B4 run02–03 教訓(2026-10-21,非白名單欄型〔先 TIME,後全 any〕條件拒收,R-FLOAT-07)

- **`any` 型別的危險不在 TIME 一型**:真 Jet 全型別探測(`tmp/probe-any.mjs`)顯示,reladb `getColKind` 歸 `any` 的型別宣告於文字欄時失去 Jet 的不分大小寫比較(`$ne`/`$nin` 多命中、`delAll` 多刪),宣告於日期時間欄時 `T` 與空白分隔字串不等(`$eq` 漏、`$ne` 多)。只修 TIME 是主控裁示的最小範圍,其餘列於 LFL7、LFL8。**判斷是否 fail-closed 看[錯誤方向是否為多刪],不看型別名**。
- **拒收的落點**:放在 `findAll` 讀全表之前(`getMd` 之後),而非 `queryMemory` 內——後者在 `jet.query` 之後,且 `cvFind` 先行會讓[欄名不存在/值型別不符]搶先於 TIME 訊息;以[資料庫檔不存在仍得 TIME 訊息]斷言先於讀取,以[同條件含不存在之欄得 TIME 訊息]斷言先於 cvFind(變異 T2、T14 各殺一種錯位)。
- **欄名解析要含資料庫欄名**:cvFind 允許以 `attr.field` 引用欄,自寫的走訪若只比屬性名會被 `{c_tm: …}` 繞過(變異 T5 殺)。
- **run03 擴為全 `any`(方案 A)**:主控理由——Jet 沒有 ENUM/JSON/BLOB/UUID/TIME 等欄型,於 mdb model 宣告者必為誤宣告,與 TIME 同構;故判定由 `type.key === 'TIME'` 改為 `getColKind(attrs, 屬性) === 'any'`(沿用 reladb 單一擁有者,不另維護型別清單;VIRTUAL 非資料庫欄,留給 cvFind 以 `unknown column name` 拒收)。**訊息帶型別名但須過濾**:型別名取自 model 的 `type.key`(非條件值),仍以 `^[A-Z][A-Z0-9 _]{0,31}$` 過濾,不合者(無 type、key 非字串或含異常字元)一律固定為 `unknown`,避免 model 內容原樣進入錯誤訊息。
- **白名單對照組不可省**:只證明[any 被拒]不足以證明[沒誤殺];第三組以 17 個白名單欄型、67 個條件對 Jet 原生 `WHERE` 比命中集合,並以[收緊一個分類〔str/int/num/date/dateonly/bool〕視為 any]之變異證明對照組能殺誤殺。
- **ARRAY/GEOMETRY/GEOGRAPHY 的不帶條件 `select()` 仍失敗**(sequelize sqlite 方言建表即拋 `values.map is not a function` 等),屬範圍外,README 已載。
- **變異腳本陷阱**:`String.prototype.replace(a, b)` 的 `b` 含 `$'`、`$&`、`$$` 會被當替換樣式(變異字串裡的 `'$'` 恰為 `$'`,把其後整段原文塞進去,產出語法錯誤的副本,mocha 回報 `passing=0 failing=0` 而被誤記為存活);一律用函式替換 `replace(a, () => b)`,且 `passing=0 failing=0` 要視為無效變異而非存活。

## bin-mdb 教訓(2026-10-28,D 類外部執行檔制式規格,R-BIN;dspec〈外部執行檔之存放下載校驗與離線〉)

- **接手先驗 `node_modules/wsemi/src`**:主控預跑之 `npm i wsemi@1.9.27` 以 exit=1 結束(21 秒),留下殘缺的 `node_modules/wsemi`(只有 LICENSE/docs/examples,缺 `src/` 與 `package.json`);重跑 `npm i wsemi@1.9.27`(約 2 分鐘)即正常。`npm i` 另把 `package.json` 末尾補了換行、`package-lock.json` 之 version 欄由 1.0.41 同步為 1.0.43(皆非本輪意圖,無害)。
- **舊 `getFdExe` 依 cwd 找 exe**(`path.resolve()` 之 `./src/` 或 `./node_modules/w-orm-mdb/src/`):從他處 cwd 執行必失敗(HEAD 副本自 repo 根執行得 `can not find folder for connMDB`,自副本內執行才過)。新版 `pkgRoot` 由 `import.meta.url` 推得,不依賴 cwd;`unit-ensurebins` 之 jet 整合案以他處 cwd(`os.tmpdir()`)執行,舊設計不可能通過。
- **UMD**:rollup 把 `import.meta.url` 轉為 `pathToFileURL(__filename)`,`dist/` 之上一層即套件根。驗證法:`rollupFiles` 之 `fdTar` 指到 `./tmp/…`(不動追蹤中的 `dist/`),模擬 `<根>/dist/*.umd.js` + `bin/manifest.json` + `bin-cache/`,於他處 cwd `require` 後跑 `ensureBins()` 與 `insert`/`select`。`os`、`url`、`crypto`、`stream`、`stream/promises`、`child_process` 被 rollup 視為外部相依(警告 guessing 名稱),Node 下可用,不需改 `gDistRollup.mjs`。
- **匯出形狀**:以靜態屬性 `WOrmMdb.ensureBins` 匯出(`import wo from 'w-orm-mdb'; wo.ensureBins()`),不加 named export——w-package-tools 建置期檢查單一 default 匯出,named + default 之 UMD 會變成 `exports.default`,破壞 `require` 使用者。
- **中介檔位置**:原本寫在 exe 旁(`src/`),exe 移入內容定址快取後不宜混放(快取可能共用或唯讀),改 `os.tmpdir()`。Windows 的 `os.tmpdir()` 讀 `TEMP`,測試以 `TEMP`/`TMP` 指向測試資料夾(驗用畢即刪)與不存在之資料夾(驗位置:應 `ENOENT`)。**位置要用[放哪裡才會失敗]驗證,不能只看事後殘留**:變異 MU6(中介檔寫快取夾)不被[快取內只有 exe]殺死(中介檔用畢即刪),是靠[TEMP 指向不存在資料夾仍成功]殺死。
- **測試供檔**:`test/tools/binEnv.mjs`(由 `unit-setup.mjs` 與 `tools/srcDir.mjs` 載入)把 `bin/connMDB.exe` 依清單 sha256 播種到預設快取 `bin-cache/<sha256>/`,並設 `W_BIN_OFFLINE=1`(測試絕不連網;`bin/` 與清單不一致時離線明確失敗)。專案 `CLAUDE.md` 稱 `unit-setup.mjs`[載入無副作用]已過時。`W_BIN_OFFLINE` 設在父行程後會被子行程繼承,以子行程驗環境變數之測試須自行先刪三個 `W_BIN_*` 再設(`envOf`)。
- **斷言錯誤格式**:`E_OFFLINE_MISSING` 之 `err.missing[0]` 有 `name/sha256/size/cachePath/mirrorPath`,訊息含完整路徑,可直接斷言(`unit-ensurebins` › T6)。
- **每次 `runOnce` 呼叫 ensureBins 之成本**(`tmp` 內 bench,Windows,快取命中已校驗者):約 0.8 ms/次(500 次循序與併發皆然),首次(含雜湊 11776 位元組)約 7 ms;對照一次 `jet.query`(含 exe 冷啟)約 238 ms,不到 0.4%。故不另做行程內路徑記憶(記憶會繞過 D4 的檔案識別比對)。
- **變異**:10 個(`.npmignore` 三行、清單 sha256/commit、中介檔位置、pkgRoot 依 cwd、不匯出、吞錯、忽略環境變數鏡像)殺死 10、存活 0,基準 17 案綠。變異腳本以記憶體內原文還原並比對還原後內容。
- **範例腳本前後相同**:`g-js`、`g-json`、`g-js-encryption`、`g-js-concurrency` 於 HEAD 副本(`git archive HEAD` 解到 `./tmp/`,須自副本內執行)與現況之輸出(隨機 id 正規化後)逐行相同。範例會覆寫根目錄 `worm.mdb`:執行前複製備份、事後以 `cp` 還原,`git status` 無變。
- **未做**:真實 GitHub 網址之下載(測試不得連外網;網址形狀由本機伺服器之路徑斷言涵蓋:`/<repo>/<commit>/bin/connMDB.exe`)。發布前建議在連網機器實跑一次 `WOrmMdb.ensureBins()`(提交 3ca537c 已推上 GitHub)。
