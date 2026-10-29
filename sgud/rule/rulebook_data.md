# 規則帳本 — 寫入值與實例類

本檔自 `sgud/rule/rulebook.md` 分拆(2026-10-30,mig-mdb2;全域設定 §14:過長即整理)。節號與標題不變,內容原樣搬移,未刪未改;「哪類查哪檔」之索引見 `sgud/rule/rulebook.md`。

## R-DATE 寫入 DATE 欄之日期範圍與字串正規化(2026-10-20 立;排程第 83 項、第 79 項;來源:審計 run01〔`tmp/run01/`〕、主控複審 run01 之 D1–D11)

### R-DATE-00 單一擁有者與站點全集

- **判定**由純函數模組 `src/dateRange.mjs`(無 I/O,定位同 `pk.mjs`)單一擁有:`YEAR_MIN=100`、`YEAR_MAX=9999`、`inJetDate`、`normDates`。其他模組不得另寫「何謂可寫入 Jet 的日期」之判定。
- 站點:①寫入前整批預檢 3 處(`insert`、`insertBulk`、`save`,皆在 `procPk` 之後、任何 `jet.run` 之前;`WOrmMdb.mjs` 內的 `chkDates`);②`escVal`(`getCmd.mjs`)Date 分支的最後一道防線(同一 `inJetDate`)。
- 盤點(行號會漂移,以指令為準):`rg -n "dateRange" src/` → 只可命中 `src/WOrmMdb.mjs`(import + `chkDates`)與 `src/getCmd.mjs`(import);`rg -n "getFullYear" src/` → 只可命中 `src/dateRange.mjs`(判定)與 `src/getCmd.mjs`(序列化);`rg -n "chkDates\(" src/WOrmMdb.mjs` → 定義 + insert + insertBulk + save 共 4 處。

### 事實(Jet 實測,`tmp/run01/d1-raw-jet.out.txt` 64 格;`tmp/run02/j1-probe.mjs`)

- Jet DATETIME 以**本地時間分量**存放(無時區),範圍為本地 `0100-01-01` 至 `9999-12-31T23:59:59`。
- 年 0–99 **無法表示**,Jet 依兩位數年規則靜默改年且不報錯:0000–0049→20xx、0050–0099→19xx,年 1–12 另被讀成「月-日-年」(`#0001-06-15#`→`2015-01-06`);**補零無效**(`#0050-06-15#`→1950)。Date 物件(`escVal` 輸出 `#Y-MM-DD hh:mm:ss#`)、字串(`'0050-06-15'`、`'06/15/0050'`)、寫入非 DATE 欄之 Date(STRING 欄存為文字 `1950/6/15 12:00:00`)皆然。
- 年 ≥ 10000 報語法錯(3075/3464/3072)。
- Jet 不收字串中的 `T` 與 `Z`(3464),亦不收含小數秒之字串與 `#…#` 常值(3464/3075):**毫秒不可能經 SQL 文字寫入**。`select` 回傳之格式 `yyyy-MM-ddTHH:mm:ss` 因此無法原樣寫回(O1,本批解)。
- 數值常值被當 OLE 序號(`40000`→2009-07-06;`true`→1899-12-29);epoch 毫秒報 3464。

### R-DATE-01 範圍規則:本地年 100–9999

- 判定 = 有限時間且 `Date.prototype.getFullYear`(本地)∈ [100, 9999]。**不用 UTC 年**:因 Jet 存的是本地分量。審計 `tmp/run01/d2-summary.txt`(7 時區 × 23 瞬間 = 161 格,對真 Jet):本地年規則誤接受 0、誤拒絕 0;UTC 年 100–9999 誤判 25;UTC 年 1–9999(w-orm-reladb 1.1.11 之規則)誤判 64。原型同 161 格:拒絕 73(= 改年 58 + Jet 報錯 15)、接受 88、接受後仍改年或報錯 0。
- 可攜性代價:同一瞬間在不同主機時區的可接受性不同,僅限年 100 與 9999 邊界 ±14 小時,且與 Jet 實際行為一致。

### R-DATE-02 整批語意

- 任一筆任一欄越界或無效 → **整批 reject、資料庫不變**(含 `save` 的 `autoInsert:false` 與不會寫入者;不降為該筆 `ok:0`)、`error` 事件恰一次、`change` 不發。與 `procPk` 同時機,與 w-orm-reladb 1.1.11 一致(D3)。
- 原況(1.0.38):`insert` 於 Jet 報錯時同批好筆已寫入(`stopOnError:false`、無交易,T4);`save` 為逐筆 `ok:0`+`err`(好筆已寫)。

### R-DATE-03 訊息

`invalid data: date is not a valid time in years 100-9999 at [data[k].欄名]`(不回顯值;格式比照 w-orm-reladb 1.1.11)。同筆多欄回報模型定義順序之第一個欄,多筆回報索引最小者。`escVal` 防線之訊息無位置:`invalid data: date is not a valid time in years 100-9999`。**曆法不存在者(如 `2026-02-30T00:00:00`)與年份越界共用此訊息**(訊息格式固定;外審 minimax 指出語意略廣,屬規格取捨)。

### R-DATE-04 檢查之值即使用之值

- 預檢通過之 Date 就地換成 `new Date(Date.prototype.getTime.call(v))` 之一般 Date(資料已是 `cloneDeep` 複本);`escVal` 與 `dateRange.mjs` 一律以 `Date.prototype` 之方法取值,不讀實例或子類別覆寫之方法。審計 `tmp/run01/d8-escval-subclass.mjs`:若 `escVal` 讀實例方法,覆寫 `getFullYear` 之子類別可使預檢通過(真實 2026)而序列化為 `#50-06-15 …#`(被改年)。

### R-DATE-05 值型別處置(D2 的 M1 + O1)

| 值 | 處置 |
|---|---|
| Date(任何欄位,含寫入 STRING 等非 DATE 欄) | 見 R-DATE-01;Invalid Date 同拒 |
| 字串,DATE/DATEONLY 欄,**無時區日期時間** `yyyy-MM-ddTHH:mm:ss` 或其**空格分隔**形式(小數秒任意位;即 `select` 回傳形式)(**O1**) | 驗曆法(月 1–12、日依月與閏年、時 0–23、分秒 0–59)與年 ∈ [100, 9999],通過者正規化為牆上時間字串 `yyyy-MM-dd HH:mm:ss`(**小數秒捨去**,Jet 無法經文字寫入;**不經 Date**,故與主機時區、夏令時間無關,夏令跳過之時刻亦原樣寫回)。曆法或年不符 → 整批 reject(原為 Jet 3464;空格分隔者原亦為 3464 且 `insert` 好筆已寫入) |
| 字串,DATE/DATEONLY 欄,**純日期** `yyyy-MM-dd` | 驗曆法與年後**原樣交 Jet**;不合者整批 reject(原 Jet 3464) |
| 字串,DATE/DATEONLY 欄,**ISO 8601 含 `Z` 或 `±hh:mm`/`±hhmm`**(`T` 或空格分隔,秒必有,小數秒任意位) | 驗曆法後轉為 Date(瞬間無歧義),再依 R-DATE-01(**本地年,非字串字面年、非 UTC 年**);通過者以 Date 寫入(本地分量)。偏移不合法(`+24:00`、`+08:60`)由 V8 回 Invalid Date 而拒收。原為 Jet 3464 |
| 字串,DATE/DATEONLY 欄,**其餘寫法** | 不逐一列舉文法,改掃**獨立數字串**(先 NFKC,全形數字轉半形):任一達 3 位以上而值 < 100(零填充之年份如 `0050`、`050`、`００５０`)→ 整批 reject;年在前/在後之 5 位以上年份 → reject(外審 opus F1:`0050年6月15日`、`June 15, 0050`、`15-Jun-0050`、`0050-06`、`15.06.0050`〔被讀成時間 1899-12-30T15:06:50〕等 47 種寫法對真 Jet 實測〔`tmp/run02/s1-strings.mjs`〕,凡含零填充小年份者皆被靜默改年或錯讀)。**兩位數年**(`6/15/50`、`50-06-15`,Jet 文件化寫法)與合法 3 位數以上年份(`100-01-01`、`01/01/0100`)、`2026年6月15日`、`15 Jun 2026` 等**交 Jet 原樣**;純數字串(`45000`、`20260615`)Jet 本即報 3464,亦原樣 |
| 非 Date 物件,DATE/DATEONLY 欄(`new String('0050-06-15')`、`['0050-06-15']`、`{toString(){…}}`) | `escVal` 以 `String(v)` 當字串寫出,故預檢**取同一字串**(僅呼叫一次)依上列各列判定,並**以該原始字串取代原值**(檢查之值即使用之值;外審 opus F2、argon);`String(v)` 拋錯者(無原型物件)視為不可寫入。順帶:`new Boolean(false)` 於 DATE 欄不再被寫成 `True`,改為字串 `'false'`(Jet 3464) |
| 字串,**非** DATE/DATEONLY 欄 | 不處理(文字欄原樣;Date 仍檢,見第一列) |
| 數值、布林、`null`/`undefined` | 交 Jet 或略過(現況行為不變;見 LD2) |

### R-DATE-06 條件側(D5)

不收窄。DATE 欄之條件值不經 Jet(非主鍵條件走記憶體 sqlite;DATETIME 主鍵不支援,L7),故不存在條件值被 Jet 改年而誤中;範圍檢核由 reladb `cvFind`(`dateNoTz:'floating'` 時為牆上年 1–9999)單一擁有。負偏移時區之 9999 年末日列原見 LF8,第 87 項 B4 已解(R-FLOAT)。

### 輸入空間表(審計 run01 表 ①)

(審計 run01 之探測數字;實作之測試網格見〈對應測試〉)寫入入口 6(insert、insert{returnList}、insertBulk、save 插入、save 更新、save autoInsert:false)× 值 10(Date 本地年 0001/0099 末/0100 初/9999 末/10000 初、Invalid Date、字串三種 4 位數年與兩位數年與正常)× 時區 3 = 180 格;另 insert × 23 瞬間 × 7 時區 161 格。1.0.38:靜默改年 72、部分寫入 24、DB 不變 12、正確 72(180 格);修後:拒絕 108(DB 不變)、正確 72。外審補格(run02):字串 47 種寫法 × 真 Jet、字串包裝物件/陣列/自訂 toString、`save` 不會寫入之列、ISO 字串 × 本地年 ≠ UTC 年之瞬間、空格分隔/純日期之曆法、model 欄型 × Jet 欄型、主機區域設定。未填/限制:其他 OS 區域設定(本機 zh-TW;中文寫法 `0050年6月15日` 在他區域設定下 Jet 可能報錯而非改年)、model 欄型與 Jet 欄型不一致(LD5)、非一般物件之列(LD6)。

### 破壞性變更紀錄(2026-10-20,第 83、79 項;相對 1.0.38,版號由發布流程決定)

1. 寫入 Date(任何欄位)本地年 < 100、≥ 10000 或 Invalid Date:原為靜默改年(< 100)或 Jet 報錯(≥ 10000;`insert` 好筆已寫入),改為**整批 reject、DB 不變**。
2. `save` 越界:原逐筆 `ok:0`+`err`,改為整批 reject(`autoInsert:false` 亦然)。
3. DATE/DATEONLY 欄字串含零填充小年份(獨立數字串達 3 位以上而值 < 100):原靜默改年,改為 reject;非 Date 物件(字串包裝物件、陣列等)依 `String(v)` 同判。空格分隔無時區日期時間與純日期之曆法不存在者:原 Jet 3464(`insert` 好筆已寫入),改為整批 reject。
4. 年 100–9999 之 Date:行為不變(161/161 格)。既有已被改年之資料**不遷移**。
5. 放寬(原為 Jet 3464):`select` 回傳形式之無時區字串、含 `Z`/偏移之 ISO 字串可寫入 DATE/DATEONLY 欄;`change` 事件之 `data` 帶正規化值(字串為 `yyyy-MM-dd HH:mm:ss`,ISO 帶偏移者為 Date)。
6. 主鍵條件:見 LW2、LW6(`$ne:null` 放寬;範圍運算子非 ok 界限由恆假改為依欄型比較或 reject)。
7. 實例生命週期:無可觀察行為差(R-LIFE)。

### 已知限制(LD,第 79/83 項審計範圍外觀察;皆不修)

| # | 內容 |
|---|---|
| LD1 | 毫秒截斷:Jet 不收含小數秒之字串與常值,寫入含毫秒之 Date 後 `select({d: 同一 Date})` 回空(O4);O1 的字串正規化亦捨去小數秒 |
| LD2 | DATE 欄收數值/布林:交 Jet 當 OLE 序號靜默接受(`true`→1899-12-29、`40000`→2009-07-06;epoch 毫秒報 3464),與 reladb(epoch 毫秒)不一致;非 DATE 欄之 `new Boolean(false)` 被寫成 `True`(O3;DATE 欄之 Boolean 物件已改為字串 `'false'`) |
| LD3 | `save` 更新路徑對含日期欄之列,`nModified` 恆為 1(`isEqual` 比 Date/正規化字串與 Jet 字串永不相等;資料庫實際未變)(O2)。**O1 後新增後果**:`select` 取出之列原樣 `save` 原為 `ok:0`(Jet 3464),現為成功且 `nModified:1`(即使整列未改);日期值不變 |
| LD4 | `useStable:false` 高併發下偶發 Jet 3031(`Not a valid password.`)與「Cannot open database ''」(480 次 select 中 2 次;`selectByPk` × 8 並行偶發),不在 `jet.mjs` 重試白名單(3734、3050)內(O6);測試因此不要求並行呼叫皆成功 |
| LD5 | **字串預檢依 model 欄型**(`type.key` 為 DATE/DATEONLY):model 把 Jet DATETIME 欄宣告為 TIME 或 STRING 時字串不預檢,`'0050-06-15'` 照舊被 Jet 靜默改年(外審 opus F3);model 須如實宣告。Date 物件不受此限(任何欄位皆檢)。根治需由 exe 回傳實際欄型 |
| LD6 | **資料列須為一般物件(自有資料屬性)**:原型鏈上帶 getter 之列(兩次讀值可能不同)、`Function`/`Error` 列(`cloneDeep` 不複製,預檢略過或就地改寫呼叫端物件)、覆寫 `valueOf`/`constructor`/`Symbol.toStringTag` 之 Date 子類別(`cloneDeep` 先於預檢呼叫之)不在保證範圍(外審 argon F2;皆為既有形狀,`procPk`/`pickCols` 同;JSON 來源之資料不可能有此形狀)。如需保證須以單趟快照取代 `cloneDeep`,屬較大改動,未做 |
| LD7 | 主鍵 `$ne`+`$nin`(或 `$eq`+`$in`)並列於同欄時 `castPkFind` 另置一層 `$and`,使深度倍增,貼近上限(深度 32)者被其後 cvFind 誤拒(外審 argon F3;即 LW3 所載之罕見組合,fail-closed;非本批引入) |
| LD8 | `13/01/2026`(日/月/年)被 Jet 依區域設定讀成 2026-01-13、`15.06.0050` 以外之區域相依寫法:Jet 依主機區域設定解讀,不在預檢範圍(外審 opus G8) |
| (LF8) | 已解(第 87 項 B4,R-FLOAT) |

### 對應測試

| 規則 | 測試 |
|---|---|
| R-DATE-01、04、05(純函數 + Jet 對照組) | `test/unit-date-range.test.mjs`(**Jet 對照組**:10 時區〔含早年 LMT 負偏移逾 12 小時之 Asia/Manila、恆 +14 之 Etc/GMT-14、+5:45 之 Asia/Kathmandu〕× 25 瞬間〔含 3 位數年〕= 250 格,每格先以不經受測碼之原生 SQL 常值寫進真 Jet 判定「存值是否等於寫入之本地分量」,再要求 `inJetDate` 同判;不凍結期望表,引擎行為變了測試自動跟著變。純函數:子類別覆寫 `getFullYear` 兩方向;O1 字串文法與曆法〔T/空格分隔、純日期、小數秒〕;零填充小年份之各種文法〔47 種寫法的代表 29 種〕與全形數字;非 Date 物件;ISO 含 Z/偏移之本地年 ≠ UTC 年〔Taipei、LA〕;`escVal` 防線) |
| R-DATE-01、02、03、05(經公開 API) | `test/unit-date-write.test.mjs`(入口 6 × 值 10〔好壞值各依 R-DATE-02/05 之期望〕;4 時區 × 6 個邊界瞬間逐一 `insert`〔偏移正負號明確者硬編期望,其餘取執行時本地年〕;批次好+壞/壞+好;`save` 之不會寫入之列〔cannot 主鍵、autoInsert:false 未命中〕含越界日期亦整批 reject;非 DATE 欄收 Date;DATEONLY model;21 種零填充小年份字串〔insert、save〕;字串包裝物件/陣列/自訂 toString;空格分隔/純日期之曆法;ISO 含 Z/偏移於 4 時區之存值與本地年邊界;訊息不回顯值;O1 往返〔select 取出列 → 改其他欄 → save,4 時區〕與夏令跳過時刻;呼叫端數據不被改寫)。時區輔助 `test/tools/withTz.mjs`(可巢狀,還原為呼叫前時區,時區名稱無效即拋錯) |
| R-LIFE | `test/unit-instance-lifecycle.test.mjs`(7 函數 × 並行 8;K=1/2/16;useStable:true 回歸;`init()` 兩次/並行/首次並行 close 冪等;七個入口 × 外部實例不被關閉;壞 find 不建立實例;匯入失敗關閉) |
| LW2、LW6 | `unit-find-intpk`(`int:I8` 及新增)、`unit-find-pk`(`rv:A9` 及新增)、`unit-find-keys`(`PK8` 及新增)、`unit-pkvariant`(castPkFind 純函數兩案;`$ne:null` 一案;浮點主鍵 10 個 find 之 select 命中集合 = delAll 實刪集合一案〔外審 opus 補格〕) |

### 變異(2026-10-20 run02;完整結果表見修正報告)

40 項變異,每項套用後跑對應測試檔、還原並以位元組比對驗證,**40/40 轉紅、存活 0**(清單與腳本在 `tmp/run02/mut/`,結果備份在任務夾 `agent-out/run02-evidence/mutation-*`)。

| 群組 | 變異(編號) | 轉紅處 |
|---|---|---|
| 預檢 | M-D1a/b/c(insert、insertBulk、save 拿掉整批預檢)、M-D5(預檢移到 `jet.run` 之後)、M-D14(只看第一筆)、M-D16(save 預檢略過 cannot 主鍵列)、M-D15(DATEONLY 欄不納入) | `unit-date-write` |
| 範圍 | M-D2(UTC 年)、M-D3(下限 1)、M-D3b(上限 10000)、M-D4(拿掉 `escVal` 最後防線)、M-D6(序列化讀實例方法)、M-D9(不換成一般 Date) | `unit-date-range` |
| 字串文法 | M-D7(零填充小年份守門拿掉)、M-D8(凡 3 位以上皆拒)、M-D17(非 Date 物件不轉字串)、M-D18(不做 NFKC)、M-D19(純日期不驗曆法)、M-D10(曆法上限拿掉)、M-D20(不收空格分隔)、M-D21(5 位數年不拒) | `unit-date-range` |
| O1 往返 | M-O1a(拿掉無時區正規化)、M-O1b(以 UTC 解讀)、M-O1c(改經本地 Date,夏令跳過時刻進位)、M-O1d(拿掉含 Z/偏移 ISO 轉換)、M-O1e(正規化保留小數秒)、M-O1f(ISO 偏移不檢本地年) | `unit-date-range` |
| 生命週期 | M-L1(還原共用 sequelize 變數)、M-L2(close 非冪等)、M-L5(旗標移到 await 之後,並行 close 關兩次)、M-L3(匯入失敗不關閉)、M-L4-×7(七入口 finally 改恆關閉) | `unit-instance-lifecycle` |
| 主鍵條件 | M-P1(範圍界限非 ok 還原為恆假)、M-P2(`$ne:null` 還原為 reject) | `unit-find-intpk`/`unit-find-pk` 等 |

註:①曾列之「偏移合法性冗餘檢查」變異為**等價變異**(V8 對不合法偏移回 Invalid Date,已由 `inJetDate` 攔下),冗餘程式已移除而非保留;②M-O1e 首版為**無效變異**(`reNoTz` 之小數秒為非捕獲群組,`m[7]` 恆 `undefined`,置換等於沒改而存活),已改為同時改捕獲群組後重跑轉紅;③M-D16(save 預檢略過 cannot 列)首輪存活,補測試後轉紅。

## R-WF 字串良構檢核(2026-10-21 立;排程第 66 項批 2;來源:dspec〈一之三〉9.、系列審計 run01 §5.2/§6.2、wsemi 批 0〔`chkOrmStr`、`chkOrmData`、`_cvOrmStrCases`〕、批 1 各後端報告與主控複審、使用者裁示 D1/D2/D4、主控裁示 D3/D5–D8)

### R-WF-00 單一擁有者與站點全集

- 判定單一擁有者:wsemi 之 `chkOrmStr`(單一字串)與 `chkOrmData`(資料走訪),`package.json` 下限 `wsemi ^1.9.24`。本套件不得另寫孤立代理判定(原 `pk.mjs` 之 `isUnstorable` 正規式已刪)。
- 站點(全集):①建構設定迴圈 `chkOrmStr(opt[k], { nul: false })`(`db`、`cl`、`url`、`storage`、`pk`;`WOrmMdb.mjs`);②`pk.mjs` 之 `chkPkWf`(拆包裝後 `chkOrmStr`,預設檢 NUL)與 `normPk` 之字串分支(結果 `{kind:'cannot', why}`);③`chkWf` 內 `chkOrmData(攤平後之列, { root: 'data[k]' })`;④`getCmd.mjs` 之 `escVal`、`escId` 最後防線 `chkOrmStr(s, { nul: false })`。
- 盤點(行號會漂移,以指令為準):`rg -n "chkOrmStr\(" src/` → `WOrmMdb.mjs` 1、`pk.mjs` 2、`getCmd.mjs` 2;`rg -n "chkOrmData\(" src/` → 1;`rg -n "chkWf\(" src/WOrmMdb.mjs` → 5(定義 + insert、insertBulk、save、del);`rg -n "isUnstorable|showPk|isWellFormed" src/` → 0;四個寫入函數內 `rg -c "cloneDeep\(" ` → 0(複製與攤平只在 `snap`)。以上由 `test/unit-wellformed.test.mjs` 末組掃描。
- 與 R-PK 之關係:R-PK-02 之 `cannot`(不可能存在)改為兩種——良構性(含 NUL、孤立代理)附 `why`(固定原因詞彙),長度上限(>255 字元,Jet 專屬)無 `why`。**不得改回 `invalid`**:`procPk` 對 `invalid` 在 `autoGenPk:true` 時補自動產生之主鍵,孤立代理主鍵會被 UUID 取代而「成功寫入」(reladb 1f 之陷阱);本套件 `normPk` 一向回 `cannot`,故不踩,但仍以 `chkWf` 先行檢出並由專測釘住。

### R-WF-01 規則(dspec〈一之三〉9.)

| 位置 | 規則 |
|---|---|
| 主鍵(`selectByPk` 之引數,及 `insert`/`insertBulk`/`save`/`del` 資料之 `opt.pk` 欄) | 字串不得含 NUL 或孤立代理(原因詞彙 `string contains NUL`、`string contains lone surrogate`;NUL 先報)。先拆 `new String`/`new Number` 包裝(與 `normPk` 一致) |
| 寫入資料(`insert`、`insertBulk`、`save`)之鍵名與字串值,含巢狀、陣列元素、Map/Set 等(`chkOrmData` 走訪者),**含 model 外之鍵** | 不得含孤立代理;值之 NUL 不拒(Jet 自身對含 NUL 之 SQL 文字報語法錯 3075,維持現況) |
| `opt.db`、`opt.cl`、`opt.url`、`opt.storage`、`opt.pk` | 不得含孤立代理,建構時 throw `invalid opt.<名>: <原因>`;`{ nul: false }`(NUL 不屬本規則);`String` 包裝物件為 `not a string`。`opt.storage` 為本套件之路徑承載者(比照 reladb 1f 之 `opt.storage`);`opt.pk` 為欄名,含孤立代理會被 UTF-8 改寫為另一欄名並進入錯誤訊息之路徑(外審 minimax [5]),故一併納入(reladb 不納入,此為本套件較嚴處);`opt.fdModels`(model 資料夾路徑)不納入 |
| 條件(find) | 不變:`cvOrmFind` 已拒收(`invalid find`) |

### R-WF-02 處置(與既有「無效主鍵」同形;不隨 `opt.autoGenPk` 改變)

| 函數 | 不合格 |
|---|---|
| `insert`、`insertBulk` | 寫入前整批 reject(先 `emitError` 一次再 reject,不發 `change`),不載入 model、不寫任何一筆;同批以索引最小者為準;同一筆主鍵先於資料,同物件鍵名先於值 |
| `save` | 該筆 `{n:1, nInserted:0, nModified:0, ok:0, err}`,同批其餘筆照常;含 `autoInsert:false`(原靜默 `n:0 ok:1`);不進入 `procPk`/`chkDates`/寫入(其越界日期不使整批 reject);逐筆各發一次 `error` 事件,其後整批 `change` |
| `del` | 該筆 `{n:0, nDeleted:0, ok:0, err}`(原靜默 `ok:1`),同批其餘筆照常;只檢主鍵不檢資料 |
| `selectByPk` | `null`(先於初始化,不載入 model、不送 Jet) |
| `select`/`delAll` 之 find | `invalid find`(既有) |
| 建構 | throw |

- 仍屬 Jet 專屬而維持靜默者:字串類主鍵超過 255 字元(`cannot` 無 `why`):`del` 回 `{n:0, nDeleted:0, ok:1}`、`save`(`autoInsert:true`)該筆 `ok:0` 附 `can not save data[k].<pk>, <pk> exceeds 255 characters`、`autoInsert:false` 為 `n:0 ok:1`、`insert`/`insertBulk` 整批 reject `invalid data[k].<pk>, can not be stored: exceeds 255 characters`、`selectByPk` `null`。
- 全數不合格(`save`/`del` 無合格筆)且未給 `option.instance`:不初始化(不匯入 model、不開檔),故 model 設定有誤(`cl` 指向不存在之 model)亦不會被發現——與 reladb 1f、postgresql 一致;含合格筆才初始化並照舊整批 reject。
- 預檢失敗不得關閉呼叫端持有之 `option.instance`(`finally` 對 `si === null` 不關)。

### R-WF-03 時序

`snap`(呼叫當下複製)→ 單筆轉陣列 → `chkWf`(主鍵、資料)→ 初始化(`initAdodb`,匯入 model)→ `si.err` → `procPk`(型別正規化、補值)→ `chkDates`(R-DATE)→ 寫入。`selectByPk` 之不良構檢核在初始化前。`insert`/`insertBulk` 之預檢拋錯(存取器拋錯)同樣經 `emitError` + reject。

### R-WF-04 檢查之值即使用之值(TOCTOU 核對;比照 postgresql 1e、reladb 1f)

1. **呼叫當下複製**:`useStable:true`(預設)時各函數經 `pmQueue`,其於執行前 `delay`,若於函數內才 `cloneDeep`,呼叫端於呼叫後立即改動原數據(重用同一陣列)會改變實際檢核與寫入之值(HEAD 即有,`toctou:*:mutate-after-call` 暴露)。`insert`/`insertBulk`/`save`/`del` 之複製移到註冊處 `snap`(`useStable` 兩種模式皆經 `snap`),函數內不再複製;複製拋錯(存取器拋錯)為 rejected promise、不發 `error` 事件(同複製移動前)。
2. **各列於呼叫當下攤平為純資料**(`flatRow`,外審 sol 補格後取代原「主鍵 pin + 獨立檢核複本」):`cloneDeep` 只解開**自有**存取器、保留原型,繼承之存取器與共用原型仍是活的——檢核後、使用前(`omit`/`pick`/`normDates`/`pickCols`/`getUpdate`/佇列等待期間)再讀即可能得到不同值(實證:存取器副作用把同列主鍵改成另一個良構鍵而更新/刪到他列;主鍵存取器第一次回 `undefined` 其後回有效鍵;呼叫後改動共用原型;前一呼叫之 change 事件改動後一呼叫之共用原型)。故 `snap` 在 `cloneDeep` 後把外層批次以**索引迴圈**建成普通陣列(不用輸入陣列或其子類別自帶之 `map`/`Symbol.species`,外審 sol 第2輪 [03]:自訂 species 令整批靜默變零筆),並對每個非純物件之列〔原型非 `Object.prototype`/`null`;陣列僅原型非 `Array.prototype` 者;內建容器 Map/Set/Date/RegExp/Error 等與自訂 `Symbol.toStringTag` 之物件**亦攤平**(sol 第3輪 [01]:不攤平則其子類別之主鍵存取器仍被重讀),並以 `Symbol` 鍵 `KEY_CONT`(不可列舉)把複製後之原物件附在攤平列上,`chkWf` 另以 `chkOrmData` 走訪之,令容器內容(Map 項目、Set 元素)仍被檢核(sol 第2輪 [06]);**既有〔無資料〕判定(非物件、空物件、空陣列、只有無關 getter 之物件)以 cloneDeep 後之原輸入為準而先於攤平**(sol 第3輪 [05]),單一 Map/Set 輸入仍視為無資料(同 HEAD)〕取:`for in` 全部可列舉屬性(自有與繼承)、原型鏈上(不含 `Object.prototype`)之存取器屬性(含不可列舉之類別 getter,保留 HEAD 即讀得到之行為),**每個名稱只讀一次**(自有資料屬性已由外層 cloneDeep 複製,直接採用;繼承而來或存取器回傳之值以 `{x:值}` 包一層再 cloneDeep 取出——與外層 cloneDeep 對巢狀值之語意相同,函式/Error/Promise 等不可複製值原樣保留,不被改成 `{}`,sol 第3輪 [02];原型上之陣列/物件與 getter 回傳之陣列亦與呼叫端分離,sol 第2輪 [04];主鍵欄與其他欄位同;存取器第一次回 `undefined` 者亦固定為自有資料屬性 `undefined`,攤平後之列為純物件,後續不會再讀到原型上的值)。**取值拋錯者**(例如與 model 無關之 getter 拋錯,sol 第2輪 [07])不立即失敗,改定義為會重新拋出同一錯誤之不可列舉存取器:僅在該欄位真被 `pickCols` 等讀取時才拋出,與 HEAD 相同;**但鍵名本身不良構者改定義為可列舉之 `undefined` 資料屬性**,令 `chkOrmData` 仍以 `<invalid key>` 檢出(sol 第3輪 [06])。**主鍵於檢核/正規化後定為唯讀**(`lockPk`,sol 第3輪 [03]):寫入語句產生過程會呼叫使用者程式碼(自訂 `toString` 等),其副作用若改動同批另一列之主鍵,後續預讀/更新/刪除會用到不同的鍵;唯讀後此類賦值於嚴格模式拋錯,整批性失敗(產生寫入語句階段尚未寫入任何一筆),以 `defineProperty` 定義為自有資料屬性(避 `__proto__`)。其後檢核、預讀、更新、事件一律讀此純資料列,不再有存取器或原型鏈讀取。純物件之列(cloneDeep 後自有存取器已成資料屬性)原樣。方法與原型上不可列舉之資料屬性不取(與 HEAD 之差:HEAD 的 `get` 會讀到後者,已於 README 破壞性變更載明)。
3. **`opt` 於建構時讀一次**:建構開始即把呼叫端之 `opt` 複製為內部設定(全部可列舉屬性〔`for in`〕與本套件讀取之十一個選項名稱〔不論可列舉與否,保留 HEAD 一般屬性存取讀得到之行為,如類別 getter、`defineProperty` 定義之不可列舉選項,sol 第2輪 [05]〕,每個名稱只讀一次,以 `defineProperty` 定義:鍵名為 `__proto__` 時不改動原型,sol 第2輪 [01];非物件之 `opt` 拋 `TypeError`),預設、檢核、解析與所有操作只用此複本(外審 sol [04]:`cl` 存取器於檢核後回傳不同值,送出含孤立代理之識別字);預設值不再寫回呼叫端之 `opt`(破壞性,README 載明)。`escId` 另有最後防線(`invalid identifier: …`)。
4. **最後防線**:`escVal`(字串進入 SQL 文字之唯一出口)再檢一次孤立代理(`invalid data: string contains lone surrogate`,無路徑),涵蓋存取器於檢核後才回傳孤立代理、自訂 `toString` 之輸出、`String(v)` 型別轉換等 `chkOrmData` 看不到之來源;`insert`/`insertBulk` 之 SQL 於 `jet.run` 前全數產出,故拋錯時不寫任何一筆。
5. **事件共享參照**:本套件所有事件皆在結果定案、寫入完成之後發出(`save` 之逐筆事件亦然),回呼改動事件所帶之 `data`(攤平後之複本)無從影響其後各筆之寫入;而回呼改動**呼叫端原物件所共用之原型**對其後已呼叫之呼叫亦無影響(各列已於呼叫當下攤平,專測〈前一個呼叫之 change 事件改動後一個已呼叫之共用原型〉)。無需如 postgresql 般交快照。
   巢狀值(列內之巢狀類別實例)仍保留原型、`Map` 之物件鍵為共用參照(`cloneDeep` 不複製鍵),呼叫端於呼叫後改動它們不在保證範圍(LWF10);其流入 SQL 文字之字串仍受最後防線把關。
6. Date 子類別/包裝物件之處理見 R-DATE-04。

### R-WF-05 訊息詞彙(固定、不回顯值;路徑之索引為批次索引,主鍵欄名跟隨 `opt.pk`)

`invalid id: <原因> at [data[k].<pk>]`、`invalid data: <原因> at [data[k].<路徑>]`(不合格之鍵名顯示為 `<invalid key>`)、`invalid opt.<名>: <原因>`、最後防線 `invalid data: <原因>`。順帶去回顯(D6):`invalid data[k].<pk>, type mismatch with pk column […] in model […]`、`invalid data[k].<pk>, can not be stored: exceeds 255 characters`、`can not save data[k].<pk>, <pk> exceeds 255 characters`、`can not save data[k].<pk> in N tries`、`del` 之 `invalid data[k].<pk>`;`showPk` 已刪。

### R-WF-06 已知限制(LWF)

| # | 內容 |
|---|---|
| LWF1 | **Jet 排序規則弱相等(D4,只文件化)**:Jet 字串等值忽略大小寫、尾端空白、全半形、假名與增補平面字元,良構字串亦相等——`'a'`、`'a'+emoji`、`'a'+U+FFFD` 為同一主鍵(實測:`selectByPk('a'+emoji)` 命中 `'a'`,`del({id:'a'+emoji})` 刪掉 `'a'`;`insert` 之第二筆視為已存在)。與大小寫同屬設計(R-PK-00),`createStorage` 不改;README 載明 |
| LWF2 | `new String(…)` 包裝物件:`chkOrmData` 以其字串值檢核,寫入時 `escVal` 以 `String(v)` 取為原始字串(Jet 只存文字,讀回為一般字串,與 lmdb/mongodb 之「不改存放形式」不同,README 已更正)。主鍵之包裝物件依 R-PK 拆包 |
| LWF3 | `toJSON`/自訂 `toString` 之輸出不經 `chkOrmData`;若流入 SQL 文字則由 `escVal` 最後防線拒收(整批 reject,訊息無路徑) |
| LWF4 | 值之 NUL 不屬共用檢核:Jet 對含 NUL 之 SQL 文字報語法錯 3075(`insert`/`insertBulk` 整批 reject,`save` 該筆 `ok:0`),訊息為 Jet 之原文,不是共用詞彙 |
| LWF5 | 既有資料不遷移(D8):修正前寫入之孤立代理碼元已被橋接改寫為 U+FFFD,無從還原;README 載明檢出法(含 U+FFFD 之列)與以 Jet 弱相等為由之 `del` 注意事項 |
| LWF6 | `chkOrmData` 走訪繼承自 `Object.prototype` 以外原型之可列舉屬性,即使本套件不寫入(非 model 欄)亦拒收其中之孤立代理(誤拒,與 postgresql 1e 同) |
| LWF7 | 全數不合格免初始化使 model 設定錯誤不被發現(R-WF-02);非純物件之列多一次攤平(for in + 原型鏈掃描) |
| LWF8 | `opt.fdModels`(model 資料夾路徑)含孤立代理不於建構時檢(`opt.pk` 已納入建構檢核,`escId` 另有最後防線) |
| LWF9 | 攤平後原型上**不可列舉之資料屬性**(非存取器,例如 `Object.defineProperty(proto,'name',{value:'x'})`)與方法不再被讀為欄位值(HEAD 的 `get` 會讀到前者);可列舉之繼承屬性與原型鏈存取器照舊 |
| LWF11 | 檢核期間(`chkOrmData` 走訪巢狀存取器、`flatRow` 取值)會執行使用者程式碼;其副作用若在**檢核期間**改動同批另一列之主鍵(尚未唯讀),改動後之值即成為該列檢核與使用之值(前後一致,屬使用者自改輸入),不屬「檢查後再改」;主鍵一旦正規化即唯讀(`lockPk`) |
| LWF10 | 列內**巢狀**之類別實例(保留原型)與 `Map` 之物件鍵(`cloneDeep` 不複製)為共用參照,呼叫端於呼叫後改動它們不在保證範圍;其流入 SQL 文字之字串由最後防線把關 |

### R-WF-07 破壞性變更紀錄(2026-10-21,第 66 項批 2;相對 1.0.39,版號由發布流程決定;「原行為」取自 HEAD 實跑 `tmp/head-probe.mjs`)

見 README〈Breaking changes: well-formed strings〉。要點:①寫入值/資料鍵名之孤立代理原靜默存成 U+FFFD,改為 `insert`/`insertBulk` 整批 reject、`save` 該筆 `ok:0`;②`del`、`save`(`autoInsert:false`)對 NUL/孤立代理主鍵原靜默 `ok:1`,改 `ok:0`+固定詞彙 `err`(D5);③訊息去回顯(D6);④建構 `opt.db/cl/url/storage` 含孤立代理 throw,`String` 包裝物件為 `not a string`;⑤四個寫入函數於呼叫當下複製(`useStable:true` 原於佇列輪到時才複製)。

### R-WF-08 對應測試

| 規則 | 測試 |
|---|---|
| R-WF-01~03、05(案例表逐案) | `test/unit-wf1~6.test.mjs`(共用層 `test/unit-wf-setup.mjs`;資產 `test/assets/worm_wf_def.mdb`〔表 `twf`:`id TEXT(255) PK`、`name MEMO`;`twfk`:主鍵欄 `key`〕與 `test/assets/models/twf.js`、`twfk.js`,`node toolg/genTestMdbAssets.mjs worm_wf_def.mdb` 產生):wsemi `_cvOrmStrCases` API 層 1305 案 × 三輪(`autoGenPk` 預設全表;`autoGenPk:false` 之 id/single/val/order 四組;`useStable:false` 之 toctou/order 兩組)= 2367 工作,**略過 610**(`gfs` 210、`doc` 400:本套件無 GridFS,固定欄位 model 無從[接受後讀回]巢狀結構與任意鍵名之接受案;拒收案不需 doc,全數照跑)。每案另斷言:整批 reject 時 `error` 事件恰一次且不發 `change`、逐筆失敗時 `error` 事件數等於失敗筆數、失敗之呼叫不改動呼叫端傳入之物件 |
| R-WF-00、02、03、04、05 專屬 | `test/unit-wellformed.test.mjs`:`chkPkWf`/`normPk` 純函數、`escVal`/`getInsert`/`getUpdate` 最後防線、建構 `opt` 逐名稱 × 形態、預檢先於初始化(`cl` 指向不存在 model)、全數不合格免初始化、`selectByPk` 免初始化、`option.instance` 不被關閉、`snap` 於兩種 `useStable` 模式、繼承存取器三案(第一次不合格 / 其後不合格 / 副作用)與主鍵固定、去回顯、`opt.pk` 跟隨(`twfk`)、`autoGenPk:true` 不補值、`del` 不檢資料、`save` 不合格筆不進日期預檢、單一出處與站點掃描 |
| `del` 對 NUL/孤立代理主鍵 `ok:0` | `test/unit-pkvariant.test.mjs`〈含NUL與孤立代理〉(原斷言 `ok:1` 已更新為 D5 新行為) |

## R-LIFE 實例生命週期:sequelize 之持有與關閉(2026-10-20,第 79 項③;LW7 已解)

- `initAdodb` 回傳之實例**自帶**其 sequelize(區域變數),`close` 只關閉**自己的**,以旗標保證冪等;不再有實例層(閉包)共用之 `sequelize` 變數,也沒有共用的 `closeSequelize`。
- 7 個函數之 `finally` 改為 `await si.close()`,條件不變(`select`/`delAll` 為 `inited`,其餘為 `instance === null`);壞 find 不初始化(R-WL-01)不變。
- `initSequelize`(`queryMemory.mjs`)匯入 model 失敗時,先關閉自己剛建的 sequelize 再 reject(原每次失敗漏關 1 個)。
- 事實(審計 run01):被漏關的僅 Sequelize 物件(主實例只 `importModels` 取 `rawAttributes`,從未查詢,故從未開啟 sqlite3 連線;真正開連線的是 `queryMemory` 內每次呼叫自建並於 `finally` 關閉之實例),sqlite3 連線開 = 關(39 格全測)、無行程、可自行結束、GC 後堆積不成長;原漏關數 = 並行數 − 1。
- 關閉語意:`close` 後 `mds` 之 `rawAttributes` 仍可讀(不查詢),但文件載明「close 後不再使用」;`pmq`(模組層佇列)不動。

