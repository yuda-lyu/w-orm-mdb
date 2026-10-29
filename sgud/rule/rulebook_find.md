# 規則帳本 — 條件(find)類

本檔自 `sgud/rule/rulebook.md` 分拆(2026-10-30,mig-mdb2;全域設定 §14:過長即整理)。節號與標題不變,內容原樣搬移,未刪未改;「哪類查哪檔」之索引見 `sgud/rule/rulebook.md`。

## R-FIND select/delAll 之條件(find)轉譯(2026-10-16 立;排程第 32 項;來源:審計 run01、主控複審 run01 之 Q1–Q9、w-orm-reladb 1.1.9 帳本 R1–R8 與〈深引用者(w-orm-mdb)接線契約〉)

### R-FIND-00 單一擁有者

- **形狀檢核**:wsemi 之 `cvOrmFind`,見 R-WL-00(第 33 項批 2;`normFind` 為唯一呼叫處)。
- **非主鍵條件**:w-orm-reladb 之 `cvFind`(深引用 `w-orm-reladb/src/cvFind.mjs`,相依 `^1.1.10`;Q1 ①)。值依欄型檢核、DATE、NULL 三值語意、嚴格鍵皆以 reladb 帳本為準(運算子白名單與形狀層已移至 wsemi `cvOrmFind`;`$regex` 已移除);本套件不得另寫同類判定,也不得於 cvFind 前後改寫非主鍵之鍵或值。
- **主鍵條件**:`src/pk.mjs` 之 `castPkFind`(R-PK-05、R-FIND-03),只處理鍵與 `opt.pk` 完全相符者,其餘子樹原樣保留交 cvFind。
- select 與 delAll 共用 `findAll`(系列最低要求①:同一 find 於 select 命中者即 delAll 刪除者)。
- 盤點(行號會漂移,以指令為準):`rg -n "cvFind\(" src/` → 只可命中 `src/queryMemory.mjs` 之 1 處;`rg -n "findAll\(si" src/WOrmMdb.mjs` → select、delAll 2 處;`rg -n "getUseFind|Op\.substring" src/` → 0;`rg -n "cvOrmFind\(" src/` → `src/WOrmMdb.mjs` 之 1 處。

### R-FIND-01 接線(reladb 契約)

- `ctx.attrs` = 記憶體過濾表 model 之 `rawAttributes`(`queryMemory` 內 `define` 之後;欄名即來源 model 之屬性名、無來源 `field`、字串類為 CITEXT、含序號欄 `keys.wi`);不得傳來源 model 之 attrs。
- 過濾表只納入 **Jet 列實有之欄**(列非空時取首列之鍵;connMDB.exe 每列輸出全部欄位,NULL 亦有鍵):model 有而 Jet 表無之屬性(model 過時、欄名大小寫不符)不納入,引用之條件由嚴格鍵 reject(`unknown column name`)。(2026-10-16 run02 外審 opus [2]:否則該欄恆為 NULL,`{欄:null}`、`$exists:false`、`$nor:[{欄:{$ne:null}}]` 命中全部列而 delAll 刪光全表;1.0.35 同,屬既有缺陷一併修正。)無列時無從得知,不篩選(見 LF6)。**`opt.pk` 亦須為 Jet 列實有之欄(完全相符)才辨識主鍵條件**(`findAll` 之 `pkKey`;model 有 `id` 而資料表為 `ID` 者,主鍵等值/否定條件若仍改寫為序號條件,因取不到存值而被化簡為「查無」或「全部」,令 select 漏查、delAll 拒收;現改為不辨識,交 cvFind 以嚴格鍵 reject `unknown column name`;外審 sol F03,既有路徑之缺陷;無列時無從得知,見 LF6)。
- `ctx.escape`、`ctx.dialect` **不傳**(reladb 1.1.10 起已不使用;原供 `$regex` 之 LIKE 字面常值與 sqlite 判定);`ctx.dateNoTz = 'floating'`(第 87 項 B4 起;原 `'local'`。Jet 之 DATETIME 為無時區牆上時間,select 回傳 `2026-01-01T00:00:00`;條件值換算為牆上時間分量再作為 UTC 瞬間,令 `select({dt: row.dt})` 命中該列且與主機時區無關;**資料側須同進同退**,見 R-FLOAT)。
- `ctx.pk` **不傳**:cvFind 對主鍵欄於 sqlite(NOCASE)判等值,違反 R-PK-00;主鍵條件已先由 castPkFind 改寫為序號條件。
- cvFind 拋錯 → 關閉記憶體 sequelize 後 reject(經 select/delAll 之 catch 發一次 `error` 事件)。

### R-FIND-02 入口與前處理不得丟失條件(reladb 契約第二條;第 33 項批 2 起由 R-WL 承接)

- 入口檢核與快照改由 wsemi 之 `cvOrmFind` 單一擁有(R-WL-00):`normFind` 回傳全新 null 原型深複本,其後 `castPkFind` 與 `cvFind` 只讀複本。原 `snapFind`/`snapBuiltin`(自寫快照:循環參照記錄、深度 66、Date/RegExp 以內建方法重建)與「非物件與陣列視為 `{}`」「函數 reject」之入口判定已刪除,其規則(循環參照、深度、Proxy、getter、內建物件原型被改、函數、非物件)皆由案例表 T、H 組涵蓋。
- 走訪複本一律 `Reflect.ownKeys`(`castPkFind`);不得對 find 用 lodash `each`/`keys`/`size`、`Object.keys`、wsemi `isobj`、`cloneDeep`。盤點:`rg -n "each\(find|keys\(find|size\(keys|isobj\(find|cloneDeep\(find" src/` → 0。
- delAll 全刪之條件見 R-WL-02(複本無自有鍵才走 `DELETE FROM`)。
- (歷史,2026-10-16)原載之 select/delAll 對陣列元素讀值拋錯不一致、已撤銷 Proxy 在 try 外、函數視為 `{}`、同一物件被引用兩次之指數展開(OOM)、深度換算(cvFind 計 1 而快照計 2)等缺陷,皆源於本套件自寫之快照;改用 cvOrmFind 後由其「每值只讀一次、節點預算、結構化複製證明無品牌物件」承擔。

### R-FIND-03 主鍵條件之改寫(castPkFind;R-PK-03/05 之延伸;第 33 項批 2 改寫)

- 輸入為 `normFind` 之複本(R-WL-00),**在複本上單趟走訪**(R-PK-05),每個值只讀一次;純量為字串、有限數字、布林、Date、`null`(其餘型別已由 cvOrmFind 拒收,故 castPkFind 不再拆包裝物件、不處理 BigInt/Proxy;`normPk` 對資料列之包裝物件處置不變)。
- **`opt.pk` 須為 model 之屬性**,否則不辨識主鍵條件,主鍵名之鍵交 cvFind 由嚴格鍵 reject(2026-10-16 run02 外審 opus [4]:`opt.pk` 為 `ID` 而 model 屬性為 `id` 時,`{ID:{$ne:'a'}}` 之 select 命中全部而繞過嚴格鍵)。
- **只認 `k === opt.pk`**(完全相符,與 reladb 嚴格鍵一致):大小寫變體(`ID`)、尾端空白(`'id '`)等近似鍵不另處置,原樣交 cvFind 由嚴格鍵 reject(Jet 字串等值不分大小寫且忽略尾端空白,若近似鍵改由 sqlite 判等值,於 `$ne` 會誤刪)。
- 主鍵欄之值與運算子(**僅白名單**):
  - 純量(隱含等值)、`$eq` → 序號 `$in`;`$in`(純量陣列)→ 序號 `$in`(`$in:[]` → 不存在之序號 `-1`,必不命中)。
  - `$ne`、`$nin` → 序號 `$nin`(**否定語境**:值含無效主鍵值〔布林、Date、`''`〕或型別不符者 reject `invalid find: invalid primary key value in negative condition at [find.….$ne|$nin]`(不回顯值),R-PK-03 4b 維持;`$nin` 之空集合已被 cvOrmFind 拒收)。**例外(第 79 項 run02,LW2 已解):`$ne:null` 不是無效值,原樣留於原欄交 cvFind 轉為 `IS NOT NULL`**(與非主鍵欄、reladb 一致;dspec〈一之三〉6. 之可攜寫法 `{$and:[{pk:{$ne:null}},{pk:{$ne:x}}]}` 於主鍵欄亦可用)。`{pk:null}`、`$eq:null` 維持肯定語境無效值不命中(主鍵不可能為 NULL,且 NULL 主鍵列無從以 `=` 刪除)。`$nin:[null]` 已被 cvOrmFind 拒收。
  - `$gt`/`$gte`/`$lt`/`$lte`:**僅 `normPk` 為 `ok` 時以正規化值留於原欄;其餘(`mismatch`、`cannot`、`invalid`)原樣留於原欄交 cvFind**(第 79 項 run02,LW6 已解):整數主鍵之非整數界限(`2.5`)、超過 255 字元之字串界限依欄型正確比較(`k > 2.5` → 3,4,5;`id < 'z'×300` → 全部);cvFind 欄型檢核不接受者(`'abc'`、`'3.5'`、布林、Date 於整數主鍵;布林、Date 於字串主鍵)reject。等值、`$in`、`$ne`、`$nin` 之處置不變(對等值而言,不可能等於主鍵欄之值即不命中,本就正確)。
  - 其他運算子:正常不可能到達(cvOrmFind 已拒),若到達則原樣留於原欄,由 cvFind 再拒(第二道)。
- **已移除**:`$not`/`Op.not`(欄位層與文件層)與其整體取反遞迴(`castNot`)、`$nor`、`$regex`/`$options`、Symbol `Op` 鍵與其對照表(`MAP_OP_SYM`)、陣列值即 `$in`、RegExp 值、頂層 `$not` 保留功能(Q2)。否定語境因此只剩 `$ne`、`$nin`。
- 衍生之序號條件**併入同一物件**(欄位 `wi` 之運算子物件;不增巢狀層,外審 sol F02),同運算子重複才另以字串鍵 `$and` 置放,不併入呼叫端之 `$and`;邏輯陣列之元素其主鍵條件皆化簡掉者以恆真之序號條件代替空物件(外審 sol F01);序號條件見 R-WL-03;不產生 literal。
- 邏輯走訪:`$and`/`$or`(陣列)沿用當前語境;其餘子樹原樣。非物件與非一般物件原樣返回(不可能到達,交 cvFind 拒收)。
- 非運算子物件(`{}`)作為條件值視為無效主鍵值,不得使主鍵條件消失(保留之防線:cvOrmFind 已拒空運算子物件,castPkFind 單獨被呼叫時仍 fail-closed)。

### R-FIND-04 語意(由 cvFind 決定;本套件之差異)

- 嚴格鍵:鍵須與記憶體 model 之屬性名完全相符(該 model 無 `field`,故即來源 model 之屬性名);大小寫變體、尾端空白、model 未列之欄、sqlite 隱含欄 `rowid`、含 `.`/引號/方括號/首尾 `$` 之鍵、`Object.prototype` 成員名、`__proto__`、`''` → reject(`unknown column name`/`unsupported column name`)。
- 字串欄 NOCASE(CITEXT,L4);`$regex`、`$options` 已於第 33 項批 2 移除(白名單外,reject `unsupported operator`)。欄名另須符合白名單文法(R-WL-00;LW1)。
- DATE 欄:條件值(無時區字串、Date、epoch、帶時區字串)換算為浮動時間(`dateNoTz:'floating'`,R-FLOAT);純日期(`'2026-01-01'`)reject;帶時區之字串、Date、epoch 先得瞬間再取主機本地分量。
- 主鍵欄**等值類**之肯定語境無效值不命中、否定語境 reject(Q5,維持;reladb 兩種語境皆 reject,差異記於 reladb 帳本 R8)。**範圍運算子之非 ok 界限**交 cvFind(R2,見 R-FIND-03;與 reladb 之差異:reladb 對整數主鍵 `$gt:2.5` reject,本套件依欄型比較);`$ne:null` 交 cvFind(與 reladb 相同)。

### 已知限制(L-FIND)

| # | 內容 |
|---|---|
| LF1 | cvFind 所用之 sequelize 與記憶體 sqlite 之 sequelize 為不同份(模組身分不同)時,非主鍵條件中產生 literal/where 物件者(1.0.36 為空 `$in`/`$nin`、`{}` 子式如 `$or:[{}]`、`$regex`;第 33 項批 2 後除 `$in:[]` 外皆已被白名單拒收,而 `$in:[]` 據 reladb 1.1.10 報告改為不含 literal 之 `IS NULL AND 1 = 0`,**兩份情形於第 87 項 B4 實測〔`tmp/probe-twocopy-in.mjs`,reladb 1.1.14〕:單一佈局 `{n:{$in:[]}}`、`{d:{$in:[]}}` 回 `[]`;兩份 sequelize 時 reject `Invalid value Literal { val: '1 = 0' }`,fail-closed,殘餘照舊;日期條件與非空 `$in` 不受影響**)reject `Invalid value Literal…`,其餘條件正常;fail-closed,不誤刪(2026-10-16 實測 `tmp/run02/twocopy/probe.mjs`:以巢狀之 sequelize 副本載入 cvFind)。主鍵條件之序號改寫不產生 literal,兩份時亦正常(`tmp/run02/verify/opus/p4-twocopy-pk-newapi.mjs`;原載「其餘條件正常」未涵蓋主鍵條件之 `{}` 佔位,run02 外審 opus [6])。本套件不直接相依 sequelize,一般安裝下兩者解析至同一份 |
| LF2 | 主鍵範圍運算子依記憶體 sqlite 比較(同 L2) |
| LF3 | (已移除:第 33 項批 2 起序號條件併入同一物件而不加 `Symbol(and)` 或額外 `$and` 層,cvFind 錯誤路徑與原始 find 同形;僅同運算子重複〔`$eq` 與 `$in` 並列〕時多一層 `$and[0]`。castPkFind 自身之否定語境錯誤亦改為 `invalid find: invalid primary key value in negative condition at [find.…]`,不回顯值) |
| LF4 | (已解:第 87 項 B4 起浮動時間依牆上時間比較,夏令重疊時刻不再「取較早者」,跳過時刻亦原樣比較;見 R-FLOAT) |
| LF5 | 主鍵欄無唯一約束之資料表(同一主鍵值多列):delAll 以 `=` 逐筆刪除而刪到同鍵之全部列,與 select 不一致(run02 外審 opus [5],`tmp/run02/review/opus/p7-dupk.mjs`);R-PK 以主鍵唯一為前提,1.0.35 同,不修 |
| LF6 | 資料表無列時無從得知 Jet 之實有欄,model 過時之欄不被篩除(條件不 reject;無列可刪,select 回空) |
| LF7 | (已移除:第 33 項批 2 起非一般物件、存取器、不可列舉鍵、空 Proxy、撤銷 Proxy、陷阱拋錯者由 cvOrmFind 拒收;**合法之非空一般物件 Proxy 接受並複製**〔案例 H11〕,無自寫快照之盲區) |
| LF8 | (已解:第 87 項 B4〔2026-10-21〕起 DATE 欄日期條件以浮動時間比較。原缺陷:負偏移時區主機〔America/Los_Angeles、America/Sao_Paulo、Etc/GMT+12 等〕上 Jet 本地年 9999 末幾小時之列〔如「永不過期」哨兵 `9999-12-31 23:59:59`〕於記憶體 sqlite 換算為 UTC 年 10000 而字典序小於 `2026-…`,範圍條件結果錯誤〔80 格中 24 格〕、`delAll({d:{$lt:今日}})` 誤刪該列、該時刻作條件值被拒;正偏移與 UTC 不受影響。修後負偏移時區範圍條件與 `delAll` 皆正確;見 R-FLOAT。證據 `tmp/run01/d4-*`、`d5-*`、`d7-memory-text.mjs`) |

### 破壞性變更紀錄(2026-10-16 排程第 32 項;相對 1.0.35;Q6 接受,列入發布說明)

1. 原本可用或靜默、改為 reject:sequelize 專屬名稱(`$like`、`$startsWith`、`$between`、`$col`、`$iLike`、`$regexp`)、MongoDB 專屬運算子(`$type`、`$mod`、`$size`、`$all`、`$elemMatch`、`$where`、`$expr`)與未知運算子;class 實例、`Object.create(proto)`、Date、Map 作為 find;非字串欄收數字或數值欄收非數值字串、BOOLEAN 欄收字串、`$in` 混型別;含未跳脫正規式元字元之 `$regex`、非 ASCII 字面且給 `i`、`$regex` 用於非字串欄;`$or:[]`、`$and:{}`、陣列之洞;`__proto__` 自有鍵、空欄名;文件層 `$not` 之值為陣列、`{$not:{$and:[]}}`。
2. **嚴格鍵**(reladb 1.1.9):欄名大小寫變體(`{ID:…}`、`{NAME:…}`)、尾端空白、model 未列之欄(含 `rowid`)、點路徑與不安全欄名、`Object.prototype` 成員名 → reject;1.0.35 下大小寫變體經 sqlite 不分大小寫之欄名解析而命中(主鍵近似鍵且繞過 Jet 之等值判定)。
3. 主鍵欄之 RegExp 值由「無效值不命中」改為 `$regex`(Q4;`delAll({id:/x/})` 由刪 0 列改為依字面子字串刪除)。
4. DATE 欄之純日期字串(`'2026-01-01'`)由「依主機時區命中」改為 reject;無時區日期時間字串照常(dateNoTz)。
5. 修正(呼叫端原本得到錯誤結果):`$regex` 之 `%`/`_` 改為字面;`$in`/`$nin` 含 null;`$not:{運算子}` 不再命中全部非 NULL 列;具 `length` 鍵、Symbol 鍵、不可列舉之鍵之 find 不再被丟棄(1.0.35 之 delAll 會刪光全表);`$or:[{}]` 為全部;同義鍵並存;主鍵欄多運算子之 `$not` 改為整體取反。
6. 原本 reject、改為可用:RegExp 值、`$not:/re/`、`$nor`、`$exists`、原生 Symbol 運算子、欄名含 `$`(非首尾)、雙層 `$not`。
7. (run02 外審後增列)函數作為 find 由「視為 `{}`(select 全部、delAll 全刪)」改為 reject;model 有而資料表無之欄(model 過時、欄名大小寫不符)之條件由「該欄恆為 NULL 而命中」改為 reject;主鍵值之包裝物件以內部值為準(覆寫之 `valueOf` 不再被呼叫),只偽造 `toStringTag` 之物件為無效主鍵值;條件內之 Date、RegExp 以其內部值為準(覆寫之 `getTime`、`source` 不再被讀)。

### 對應測試

| 規則 | 測試 |
|---|---|
| R-FIND-00/01/04(運算子、值檢核、NULL、`$regex`、DATE、BOOLEAN) | `test/unit-find-basic.test.mjs`(F、V、O 組)、`test/unit-find-ops.test.mjs`(R、N、L、X 組)、`test/unit-find-keys.test.mjs`(S、K、D、B、PK 組與嚴格鍵〔new:SK〕、Symbol 鍵〔new:SY〕與 `length`〔new:LN〕、不可列舉之鍵〔new:NE〕之 delAll 不全刪、dateNoTz〔new:DT〕) |
| R-FIND-01 之過濾表只納入 Jet 實有之欄 | `test/unit-find-keys.test.mjs`〈model有而資料表無之欄〉(new:ST1–4) |
| R-FIND-02(入口、快照) | `test/unit-find-keys.test.mjs`(new:CY 循環參照/共用子物件/深層 getter;new:RV4–7 函數、陣列元素讀值拋錯、已撤銷之 Proxy;new:RV10–12 Date/RegExp 內部值) |
| R-FIND-03(單趟走訪、主鍵欄 `$not`、深層邏輯、`opt.pk`、`$options`) | `test/unit-find-pk.test.mjs`(複審 A、B、C、D 組與 new:NL)、`test/unit-find-intpk.test.mjs`(整數主鍵且 `opt.pk` 非 `id`)、`test/unit-find-keys.test.mjs`(new:RV1–3 包裝物件與 Proxy、new:RV8–9 `$options`、new:OK1–2 `opt.pk` 非 model 屬性、new:PK10) |
| R-PK-05 之 castPkFind 純函數形狀 | `test/unit-pkvariant.test.mjs`〈normPk純函數〉之 castPkFind 四條(含單趟走訪) |

- 每列 `{key, find, exp, rej?, wopt?}`,`exp` 為命中之主鍵(排序後逗號串接)、`''` 為無命中、`'REJECT'` 為應拒收;每列斷言:select 命中 = `exp`;delAll 於種子之新複本恰刪 `exp`,`n` = `nDeleted` = 實刪列數;應 reject 者兩函數皆 reject、資料表不變、各發一次 `error` 事件,給 `rej` 者訊息須符合(核對拒收原因);非 reject 者不發 `error` 事件。
- 案例 key 沿用審計矩陣(`tmp/audit02/probe/cases.mjs` 主矩陣、`review/rv-cases*.mjs` 加 `rv`/`rv2` 前綴、`review/q1-intpk.mjs` 加 `int` 前綴);本輪新增者以 `new` 前綴。
- 資產:`node toolg/genTestMdbAssets.mjs worm_find_def.mdb` 產生空表 `tc`(字串主鍵)、`tk`(整數主鍵 `k`,另有非主鍵文字欄 `id`);資料列由 `test/unit-find-setup.mjs` 於測試時以原生 SQL 寫入種子複本(DATE 值皆固定之本地時間;原載「含今日午夜列」→ 2026-10-16 run02 外審 opus [8]、sol [6] 改為固定日期,應然不隨執行日期與主機時區而變);暫存夾 `./test/temp-find-<組>/`。

## R-WL 條件(find)入口檢核:系列白名單(2026-10-19 立;排程第 33 項批 2;來源:dspec〈一之三〉、審計方案 run01 §4.5/§5.1/§6/§7、w-orm-reladb 1.1.10 實作報告 §7)

### R-WL-00 單一擁有者與呼叫

- **形狀檢核**:wsemi 之 `cvOrmFind`(`import cvOrmFind from 'wsemi/src/cvOrmFind.mjs'`,相依 `^1.9.20`)。白名單(頂層、欄位等值、`$eq $ne $gt $gte $lt $lte $in $nin`、文件層 `$and $or`)、純量型別、`null` 之可用處、空集合、欄名文法 `^[\p{L}_][\p{L}\p{M}\p{N}_]*$`、異常結構(Symbol 鍵、不可列舉鍵、存取器、洞、Proxy、品牌物件)、上限(深度 32、節點 100000、欄名 128)皆由它決定,本套件不得另寫同類判定。
- **呼叫處只有 `normFind` 一處**,參數固定 `{ maxIn: 2000, maxList: 999 }`:
  - `maxIn: 2000`:主鍵 `$in` 每個元素於 Jet 需逐筆 `=` 判定(約 1.6 ms/元素;審計實測 2000 筆約 3.6 秒),故 `$in/$nin` 長度上限下調為 2000(檢核不分欄,非主鍵欄亦同)。
  - `maxList: 999`:`$and/$or` 長度上限;SQLite 運算式樹深度上限 1000(平鋪 1000 項即 DB 錯誤),reladb 之 `cvFind` 另以 `cvGroup` 把清單遞迴二分為平衡樹(語意等價),使 999 項於記憶體過濾可執行(dspec〈一之三〉6. 之 10-19 補註)。
  - reladb 1.1.10 之 `cvFind` 第一步 `chkFindShape`(`maxList: 999`、`maxIn` 預設 10000)會對本套件交入之複本再檢核一次(冪等,複本為 null 原型物件亦接受);**它不提供 `maxIn` 注入,故 2000 上限須由本套件自己的呼叫強制**。`maxIn` 只限單一陣列,故 `findAll` 另於 `castPkFind` 之後、`resolvePkIdx`(逐筆交 Jet)之前檢查**整個 find 之相異主鍵值總數 ≤ 2000**(外審 opus F3:分散於 `$or`/`$and` 之多個陣列實測 98000 值阻塞同行程全域佇列 328 秒),超過 reject `invalid find: too many primary key values (> 2000) at [find]`(此檢查在讀表之後)。
- **其後只使用複本**(null 原型深複本,與呼叫端之 find 無共用參照):`castPkFind` 與 `queryMemory`/`cvFind` 皆讀複本;`findAll` 不再讀呼叫端之 find(檢查之值即使用之值)。`snapFind`/`snapBuiltin`(1.0.36 自寫快照)已刪除。
- 盤點(行號會漂移,以指令為準):`rg -n "cvOrmFind\(" src/` → 只可命中 `src/WOrmMdb.mjs` 之 1 處;`rg -n "snapFind|snapBuiltin" src/` → 0;`rg -n "\[Op\.|Op\.(and|or|not)|MAP_OP_SYM|from 'sequelize'" src/pk.mjs src/WOrmMdb.mjs` → 0(`pk.mjs` 不再 import sequelize;`queryMemory.mjs` 仍 import sequelize 以建記憶體過濾表);`rg -n "normFind\(" src/WOrmMdb.mjs` → 定義 + select + delAll 共 3 處。

### R-WL-01 時序與連線所有權

- `select`、`delAll` 於主 `try` 內**第一步**呼叫 `normFind(find)`,**先於** `initAdodb()`(匯入 model、建立 sequelize 實例)、`si.err` 判定、讀取與刪除:壞 find 不載入 model、不開啟資料庫檔、不送任何 SQL。此承諾限於**入口形狀檢核**(白名單、純量型別、欄名文法、上限、異常結構);通過形狀檢核但後端轉譯層不合者(欄位名不在 model 或 Jet 表、值與欄位型別不符、DATE 範圍)於載入 model 並讀取全表之後才由 reladb `cvFind` 拒收(外審 sol 實測 trace)。
- 失敗為整批性錯誤:經既有 `catch` → `emitError` 恰一次 → `Promise.reject`;`change` 不發;資料表不變。訊息為 cvOrmFind 之 `invalid find: <原因> at [find…]`(不回顯值)。
- `initAdodb()` 未被呼叫(壞 find)則不 `closeSequelize`(`inited` 旗標):`sequelize` 為實例閉包內共用變數,壞 find 之 `finally` 不得關閉他次呼叫所建之實例(`useStable:false` 並行時)。
- 本套件無 `isClosed` 概念(one-shot,無長連線),故無「closed 先於檢核」一條。

### R-WL-02 頂層與 delAll 全刪

- `normFind` 回傳**無自有鍵之 null 原型物件**代表全部:未給、`undefined`、`{}`。其餘非條件物件(`null`、陣列含 `[]`、字串、數值、布林、函數、Date、RegExp、Map、Set、類別實例、Symbol、BigInt、僅 Symbol 鍵者、原型帶條件者)一律 reject,**不再視為 `{}`**(取代 R-FIND-02 原「非物件與陣列視為 `{}`」)。
- delAll 只有「複本無自有鍵」才走 `DELETE FROM` 全刪;其餘一律經 `findAll`,與 select 同一複本(系列最低要求①)。

### R-WL-03 castPkFind 之輸入與輸出皆在白名單內

- 輸入為 `normFind` 之複本,**在複本上單趟走訪**(`Reflect.ownKeys`;R-PK-05);只認鍵 `=== opt.pk`(且為 model 屬性;R-FIND-03)。
- 輸出(序號條件)**併入同一物件**:`{ ...其餘, [wi]: { $in|$nin: [純量…] } }`(同運算子重複才另置字串鍵 `$and`;不增巢狀層,否則每層含主鍵條件之合法 find 深度被放大一倍而於其後 cvFind 內之再檢核被拒,外審 sol F02);`wi` = `__worm_wi_<亂數>` 符合欄名文法;空集合以 `-1`;不產生 literal。邏輯陣列之元素其主鍵條件皆化簡掉者以恆真條件 `{ [wi]: { $nin: [-1] } }` 代替空物件(外審 sol F01)。**不得用 Symbol `Op.and`**:reladb 1.1.10 的 `cvFind` 對 Symbol 鍵 reject(`symbol key is not allowed`),基準實測因此 127 案紅(僅因包覆形式,與條件本身是否合法無關)。
- 檢核:castPkFind 之輸出經 `cvOrmFind` 再檢核須不拋錯(測試〈主鍵條件經 castPkFind 後仍在白名單內〉:填入序號後遞迴確認無 Symbol 鍵、運算子皆在白名單)。
- 已移除:`$not`/`Op.not`(欄位層與文件層)、`$nor`、`$regex`/`$options`、Symbol `Op` 鍵、陣列值即 `$in`、RegExp 值、頂層 `$not` 保留功能(Q2)。

### R-WL-04 不變量(測試對應)

1. 案例表(`wsemi/src/_cvOrmFindCases.mjs`,255 案)逐案對公開 `select`/`delAll`:`OK`/`ALL` 命中集合 = `ids.mdb ?? ids.sql`(覆寫僅 E25、N08;測試斷言覆寫鍵恰為此二案,wsemi 增減即紅);`schema` 案可 reject 或回 `ids.sql`,**但 select 與 delAll 須同判**;`REJ` 案兩函數皆 reject、訊息以 `invalid find: ` 開頭且含 `why`、資料不變、`error` 事件於 reject 前恰一次、`change` 不發;`need.maxIn > 2000` 者(H07、H28)改視為 `array is too large` 之 REJ。
2. delAll 刪除集合 = select 命中集合,`n` = `nDeleted` = 實刪列數。
3. 專屬:壞 find 不開啟資料庫檔且不載入 model;整個 find 相異主鍵值總數 2000 可而 2001 reject(跨陣列合計、重複只計一次);`$in`/`$nin` 2000 可而 2001 reject(主鍵與非主鍵欄);`$or`/`$and` 999 可而 1000 reject;castPkFind 輸出仍在白名單內;「檢查之值即使用之值」(第二次讀取回不同值之 Proxy,主鍵欄與非主鍵欄)。
4. 變異(2026-10-19 最終一輪,對最終碼;`tmp/mut/run-mut.mjs`,結果 `run01-evidence/mut/results-final.json`;每項套用後即還原並以 `cmp` 驗證 src 與備份相同;測試集為 wl1~4 + wlx,M5/M8/M10/M12 另含 pkvariant,M8 另含 find-keys/find-pk):
   - M1 拿掉 `cvOrmFind` 呼叫(`normFind` 回傳原 find):**35 紅**,另 1 個 worker 因共享參照展開(案例 H19)記憶體耗盡崩潰。
   - M2 檢核後仍把原 find 交 `findAll`:**4 紅**(檢查之值即使用之值 3 案 + delAll 全刪判定讀複本 1 案)。
   - M3a 檢核放到 `initAdodb`(匯入 model)之後:**1 紅**(model 不存在案)。M3b 檢核放到讀取全表(`findAll` 內 `jet.query`)之後:**22 紅**。
   - M4 `maxIn` 改回 10000:**9 紅**(H07、H28、`$in/$nin` 2001 四案、上限類先於開檔案、總量案…)。
   - M5 `castPkFind` 序號條件改以 Symbol `Op.and` 包覆:**66 紅**。
   - M6 `maxList` 改為 1000:**1 紅**(初跑存活:其後 reladb `cvFind` 內之 `chkFindShape` 以 999 拒收,外觀同訊息、僅時序不同〔已讀表才拒〕;補「上限類之壞 find 亦先於開檔」案後轉紅)。
   - M8 主鍵 `$ne/$nin` 否定語境不再拒收無效值:**5 紅**。M10 序號條件取代同物件之其餘欄位(丟失其餘條件):**6 紅**。
   - M9 `delAll` 全刪判定改讀呼叫端 find(`ownKeys` 於檢核後回空之 Proxy 會走 `DELETE FROM`):**1 紅**(初跑存活;補 wlx 該案後轉紅)。
   - M11 邏輯陣列元素之主鍵條件皆化簡掉時留空物件:**3 紅**。M12 序號條件改回額外 `$and` 層:**6 紅**。M13 `opt.pk` 不要求為 Jet 列實有之欄:**1 紅**。M14 不檢查整個 find 相異主鍵值總數:**2 紅**。
   - M7 壞 find 之 `finally` 亦 `closeSequelize`(移除 `inited` 判定):**存活,屬等價變異**——共用變數 `sequelize` 僅用於匯入 model 取 `rawAttributes`(其後不再查詢),被他次呼叫關閉無任何可觀察後果;`inited` 為衛生規則,不以測試強制。

### R-WL-05 已知限制(L-WL)

| # | 內容 |
|---|---|
| LW1 | 欄名文法 `^[\p{L}_][\p{L}\p{M}\p{N}_]*$`:含空白、連字號、`$`(如測試表 `tc.p$x`)、點之 Jet 欄名**不可作為 find 之欄名**(reject `unsupported column name`);`select()` 全表仍可取得該欄之值,中文欄名(`\p{L}`)可 |
| LW2 | **(已解:第 79 項 run02,D8 選項 B)** 原:主鍵 `$ne:null` reject,使 dspec 可攜寫法 `{$and:[{f:{$ne:null}},{f:{$ne:x}}]}` 套到主鍵欄時 mdb reject 而 reladb 接受(外審 opus F6)。現:`$ne:null` 於主鍵欄原樣留原欄交 cvFind(`IS NOT NULL`),與非主鍵欄、reladb 相同。主鍵 `$ne`/`$nin` 含布林、Date、`''` 或型別不符之值仍 reject(R-PK-03 4b,不回顯值)。**使用須知**:`delAll({pk:{$ne:變數}})` 於變數為 `null` 時刪除全部非 NULL 主鍵之列(等同全刪,與非主鍵欄、reladb 相同;`undefined` 仍 reject),JSDoc 已載 |
| LW3 | (已解:castPkFind 原於每層主鍵條件多包一或兩層,深度 16 之合法 find 即被放大成 33 而被 cvFind 內之再檢核拒收,最內層主鍵者於深度 32 即拒〔外審 sol F02、本輪 `tmp/probe-lw3.mjs`〕;現序號條件併入同一物件而不增層,每層含主鍵 32 層可、33 層 reject。仍會加深之情形:同運算子重複〔`$eq` 與 `$in` 並列〕時才另置一層 `$and`,屬罕見組合,rare 邊界為 fail-closed) |
| LW4 | `$in/$nin` 上限 2000,且整個 find 之相異主鍵值總數 ≤ 2000(Jet 逐筆判定成本);超過者須由呼叫端分批 |
| LW6 | **(已解:第 79 項 run02,D7 選項 R2)** 原:主鍵範圍運算子界限為 mismatch/cannot/invalid(整數主鍵給 2.5、超過 255 字元之字串)者整個子式改寫為恆假(1.0.35 起,Q5),`k > 2.5` 回空而非 3,4,5,於 `$and`/`$or`/同物件多運算子下更放大;不會過刪(白名單已無 `$not`/`$nor`)。現:僅 `ok` 時正規化,其餘原樣留原欄交 cvFind 依欄型比較或拒收(R-FIND-03)。破壞性:`int:I8`、`rv:A9` 由空集合改為正確集合;`'abc'`/`'3.5'`/布林/Date 作範圍界限由靜默空集合改為 reject |
| LW7 | **(已解:第 79 項 run02,見 R-LIFE)** 原:`useStable:false` 並行時實例閉包內單一 `sequelize` 變數被覆寫,先建者永不關閉(並行 K 個漏關 K−1 個;`init()` 兩次漏關 1 個;model 匯入失敗每次漏關 1 個)。**澄清**:漏關者僅為 Sequelize 物件,未持有 sqlite3 連線(開 = 關)、無行程控制代碼、可 GC,屬實例生命週期簿記錯誤而非連線/行程洩漏。現:`initAdodb` 之實例自帶 sequelize,`close` 只關自己且冪等 |
| LW5 | 值語意差異屬設計(dspec〈一〉1.):字串比對不分大小寫(Jet 與記憶體 sqlite NOCASE);`$ne/$nin` 不含 NULL 列(SQL 三值),可攜寫法:排除 NULL `{$and:[{f:{$ne:null}},{f:{$ne:x}}]}`,含 NULL `{$or:[{f:null},{f:{$ne:x}}]}`;Jet 布林欄無 NULL(NULL 存為 false),故 `{flag:{$ne:true}}` 含原 NULL 列(案例 N08) |

### R-WL-06 破壞性變更紀錄(2026-10-19 第 33 項批 2;相對 1.0.36,版號由維護者定;「原行為」取自 HEAD〔含其當時之 reladb 1.1.9、wsemi 1.9.17〕實跑 11 列 `tc` 表,探測 `tmp/head-base/probe-head.mjs`;方案 §5.1 mdb 項皆在內)

1. **頂層非條件物件**:`null`、`[]`、`[{…}]`、字串、數值、`true`、BigInt、Symbol、包 `{}` 之 Proxy,原視為 `{}`(select 全部、delAll 全刪 11 列),改為 reject `condition must be a plain object`(Proxy:`an empty find must be an ordinary object`)。函數、Date、class 實例、條件在原型者原本即 reject,維持。
2. **移除**:`$not`(欄位層、文件層)、`$nor`、`$exists`、`$regex`/`$options`、RegExp 值、陣列值即 `$in`、`$in` 純量(`{id:{$in:'a'}}`)、sequelize `Op` Symbol 鍵(原命中 `{[Op.or]:…}`、`{name:{[Op.like]:'pe%'}}`、`{id:{[Op.in]:…}}`);Symbol 鍵 `Symbol('x')` 原本即 reject,維持。castPkFind 之主鍵 `$not`/`$regex`/`Op` 分支與頂層 `$not` 保留功能(Q2)隨之移除。
3. **`null`/空集合**:`$in`/`$nin` 含 `null`(原 `$in:[null,'abc']` 命中 NULL 列與 abc;`$nin:[null]` 為 IS NOT NULL)、`$nin:[]`(原非主鍵與主鍵皆命中全部,delAll 全刪)、`$and:[{}]`、`$or:[{}]`(原全部)→ reject。`$and:[]`、`$or:[]` 原本即 reject。
4. **`undefined`/無效值**:`{id:undefined}`、`{id:{$in:['a',undefined]}}`(原命中 a)、`{id:123n}`、`{id:{}}`(原不命中、delAll 刪 0)→ reject(方案 §5.1 mdb:`delAll({id:undefined})`、`select({id:123n})`);`{name:undefined}` 原本即 reject。`String`/`Number` 包裝物件值(原拆包命中)、含 NUL/孤立代理之字串值(原不命中)→ reject。
5. **異常結構**:getter/不可列舉之鍵/陣列額外屬性(原接受,getter 被呼叫)→ reject。
6. **欄名文法**:`^[\p{L}_][\p{L}\p{M}\p{N}_]*$`;`p$x`(原命中 a)→ reject(LW1);`'id '`、`'tc.id'` 原本即 reject(詞彙改 `unsupported column name`)。
7. **上限**:`$in`/`$nin` > 2000(原 5000 可,2001 可)→ reject `array is too large (> 2000)`;`$and`/`$or` 999 項(原 select 與 delAll 皆 DB 錯誤 `Expression tree is too large`)→ 可;1000 項 → reject(原 DB 錯誤);深度 32 之 `$and` 鏈(原 `find is too deep`)→ 可,33 → reject。
8. **錯誤訊息**:路徑自 `name.$foo` 改 `find.name.$foo`;詞彙改變(`value must be a string…`→`unsupported value type [x]`、`logical operator requires a nonempty array`→`$and with empty array`、`find must be a plain object`→`condition must be a plain object`、`nesting too deep`/`circular reference` 為 cvOrmFind 之 `nesting is too deep`)。
9. **維持**:`{id:{$ne:undefined}}` 仍 reject;字串主鍵由 Jet 判定;`$ne`/`$nin` 不含 NULL 列(SQL 三值)。(原載「`{id:{$ne:null}}` 仍 reject(主鍵不可能為 NULL,LW2)」→ 第 79 項 run02 改為接受,見 LW2。)
10. **內部**:`snapFind`/`snapBuiltin` 刪除;`ctx.escape`/`ctx.dialect` 不再傳給 reladb;`queryMemory` 之 `cvFind` 對複本再檢核一次(冪等)。

### R-WL-07 對應測試

| 規則 | 測試 |
|---|---|
| R-WL-04 之 1、2(案例表 255 案逐案) | `test/unit-find-wl1~4.test.mjs`(共用層 `test/unit-find-wl-setup.mjs`;資產 `test/assets/worm_wl_def.mdb`、`test/assets/models/tw.js`,`node toolg/genTestMdbAssets.mjs worm_wl_def.mdb` 產生) |
| R-WL-04 之 3(專屬) | `test/unit-find-wlx.test.mjs`:案例表契約事實(ids.mdb 覆寫鍵、need.maxIn)、壞 find 先於載入 model/開檔、option.instance、useStable:false 並行、`$in/$nin` 2000/2001、`$or/$and` 999/1000、castPkFind 輸出在白名單內、檢查之值即使用之值 |
| R-WL-03 castPkFind 純函數形狀 | `test/unit-pkvariant.test.mjs`〈normPk純函數〉之 castPkFind 四條(字串鍵 `$and`、Symbol 鍵不辨識、單趟走訪、非運算子物件) |
| 已移除功能之 reject 與可攜寫法(原 1.0.36 接受案翻轉) | `unit-find-basic`(F、V、O 組)、`unit-find-ops`(R、N、NP、L、X 組)、`unit-find-pk`(rv:A~D)、`unit-find-intpk`、`unit-find-keys`(S、K、PK、SK、SY、LN、NE、CY、RV、ST 組)、`unit-pkvariant`、`unit-basic`、`unit-delall`;註解標「1.0.36」者為原行為,以 `P` 結尾之 key 為白名單內之可攜寫法 |



## 〔條件(find)之支援範圍〕(主控 2026-10-16 依使用者交辦寫入)

- 系列盤點與處置原則:`C:\opensrcOper\dspec\w-orm系列條件語法支援盤點.md`.
- 轉譯路徑(第 33 項批 2 起):入口先經 wsemi `cvOrmFind({ maxIn: 2000, maxList: 999 })` 取複本(R-WL);主鍵條件經 `castPkFind`(由 Jet 判定命中列,改寫為序號條件),其餘條件交 w-orm-reladb 之 `cvFind`(深引用,非主鍵條件之欄位型別/DATE/嚴格鍵單一擁有者),於記憶體 sqlite 過濾;delAll 帶條件呼叫同一 `findAll`(R-FIND;1.0.35 之自寫 `getUseFind` 已於第 32 項移除).
- 支援範圍 = **系列白名單**(見下〔系列條件白名單〕):頂層(未給/`undefined`/`{}` 為全部,其餘非條件物件 reject)、欄位等值 `{欄: 純量}`、`$eq $ne $gt $gte $lt $lte`(純量)、`$in $nin`(純量陣列;`$in:[]` 恆假,`$nin:[]` reject)、文件層 `$and $or`;**1.0.36 曾支援而今 reject**:`$not`(欄位層與文件層)、`$nor`、`$regex`、`$options`、`$exists`、RegExp 值、陣列值即 `$in`、sequelize `Op` Symbol、`$in/$nin` 含 `null`、空 `$nin`、`$and:[{}]`/`$or:[{}]`、頂層 null/陣列/字串/數值(原視為 `{}`)、`undefined` 值等(完整清單見〈破壞性變更紀錄(第 33 項批 2)〉).
- 不支援之處置:一律 reject(整批性,訊息 `invalid find: <原因> at [find…]`;R-WL).
- 語意:SQL 三值;字串欄 NOCASE(Jet 不分大小寫);DATE 欄日期條件以浮動時間〔牆上時間作為 UTC 瞬間〕比較、與主機時區無關(R-FLOAT);主鍵等值由 Jet 判定(R-PK),主鍵欄肯定語境無效值不命中(Q5);`$in/$nin` 上限 2000.
- **非缺陷聲明**:本套件之支援範圍(運算子集合、NULL、`$regex`、大小寫之語意)屬設計.**不得**僅因「MongoDB 或其他 w-orm 套件支援」而視為缺陷、撰寫建議書或自行擴充;擴充或改變語意須主控同意(有更好之解法,並有全盤矩陣與第三方審佐證時才同意).
- **系列最低要求(違反者才屬缺陷)**:①同一 find 於 select 命中之數據即 delAll 刪除之數據;②不支援之運算子與無法轉譯之值必須 reject,不得靜默忽略、改變語意或擴大刪除範圍;③不得因條件清單恰為空或值為 `undefined` 而刪全表.

## 〔delAll 與 find 之頂層語意〕(主控 2026-10-16 依使用者裁示寫入;全系列規格)

- **`delAll()` 不給條件就是全刪;給條件才是部分刪除.**「不給條件」指:未傳 find、傳 `undefined`、或傳空物件 `{}`——三者皆為全部(select 亦同).
- **傳了值但不是條件物件者一律 reject**(使用者裁示 B):`null`、陣列、字串、數值、布林、函數、Date、RegExp、Map、Set、類別實例等,以整批性錯誤 reject,不得視同 `{}` 而全刪.適用於所有接受 find 之函數.
- 規格出處:`C:\opensrcOper\dspec\w-orm系列條件語法支援盤點.md` 〈一之一〉.**已於第 33 項批 2 實作**(R-WL-02:`normFind` 回傳複本,非條件物件一律 reject).

## 〔系列條件白名單〕(使用者 2026-10-17 裁示;主控寫入)

- 全文與定案細節在 `C:\opensrcOper\dspec\w-orm系列條件語法支援盤點.md`〈一之三〉;本節為摘要,兩者不一致時以 dspec 為準.
- **只支援白名單,其他一律不支援(reject,整批性錯誤,不得靜默忽略)**:
  1. 頂層:未給、`undefined`、`{}` 為全部;其餘須為條件物件,否則 reject(〈delAll 與 find 之頂層語意〉).
  2. 欄位直接等值 `{欄: 純量}`,多欄隱含 AND.
  3. 欄位運算子 `$eq $ne $gt $gte $lt $lte`(純量)、`$in $nin`(純量陣列).
  4. 文件層 `$and`、`$or`(條件物件之陣列).
  5. 其餘(`$not $nor $regex $options $exists $where $expr $function $like $ilike $custom`、子查詢、欄位層 `$and/$or`、sequelize `Op` Symbol、函數值等)一律 reject.
- 純量型別、NULL 語意、空 `$in/$nin`、欄名文法、上限等細節由排程第 33 項審計提案、主控複審後定案,回寫 dspec 與本節.
- **delAll 之 JSDoc 須載明使用須知**(使用者 2026-10-17):不給條件(未給、`undefined`、`{}`)即刪除全部;傳非條件物件會 reject;白名單外運算子會 reject;delAll 須審慎使用、非必要不用.經 w-serv-webdata 資料通道呼叫者語意與本套件一致,不另加限制.
- 狀態:**已於第 33 項批 2 實作**(2026-10-19;`cvOrmFind({ maxIn: 2000, maxList: 999 })`,規則見 R-WL;案例表逐案測試見 R-WL-04).

