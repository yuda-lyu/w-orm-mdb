# 規則帳本

本檔為套件設計與開發階段之規則帳本,為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.

## R-PK 主鍵之命中判定(2026-10-16 立;來源:審計 run01、主控複審 run01 之 Q1–Q10 裁示)

### R-PK-00 單一規則(其餘各條皆由此衍生)

主鍵等值以 Jet 唯一索引之判定為準,主鍵之定位一律以 `=` 語句(不依 `IN` 之結果下結論);主鍵值送出前依主鍵欄型別正規化;不可能存在之值不送 Jet。本套件自行判定之處只限兩處:有效性與正規化(`normPk`)、快速鍵(`kFast`,只會少判不會多判,對不上者一律以 `=` 問 Jet)。**不得以 JS 仿製之等值鍵判定主鍵等值**:多判使 select/delAll 命中 Jet 視為相異之列,少判使 `$ne`/`$nin` 把 Jet 視為同鍵之列刪除,兩方向於否定條件下皆誤刪(2026-10-16 外審 opus、sol、muse 實證;初版之 jetKey 經 1720 字元實測多判 75 組,已移除)。model 之主鍵欄一律取 `opt.pk`,不寫死欄名。

- 單一擁有者:`src/pk.mjs`(型別清單、`getPkType`、`normPk`、`kFast`、`genInnerKeys`、`castPkFind`;純函數,無 I/O;以 Jet 判定命中列之 `resolvePkIdx` 在 `src/WOrmMdb.mjs`)。其他模組不得另寫「何謂字串型別/有效主鍵/主鍵等值」之判定。
- 依據之 Jet 實測:`sgud/exp/experience.md`〈Jet 4.0 之主鍵等值與轉型〉;審計全盤 `tmp/audit01/w-orm-mdb-pk-全盤.md`。

### 軸

| 軸 | 成員 |
|---|---|
| 呼叫 | select({pk:v})、select 之 `$eq`/`$ne`/`$in`/`$nin`/陣列值、selectByPk、insert、insertBulk、save(autoInsert 兩取值)、del、delAll({pk:v})、delAll 以非主鍵條件命中 |
| 主鍵輸入 | 非空字串、Jet 等值變體(大小寫、尾端半形空白、全半形、平/片假名、ß/ss、ς/σ、非 ASCII 大小寫)、異鍵(前導空白、Tab)、有限數字、數字字串、指數數字、>255 字元、含 NUL、孤立代理、±Infinity、NaN、空字串、布林、物件、陣列、BigInt、包裝物件(`new String`、`new Number`) |
| 主鍵欄型別(model `type.key`) | 字串類、整數類、浮點類、其他 |
| 表狀態 | 空/非空、存值帶尾端空白、長字串存值(255 個 `é`) |
| 批次 | 單筆、同批變體重複、與有效列同批 |

### R-PK-01 型別清單(單一常數)

| 類 | `type.key` |
|---|---|
| 字串類 `str` | STRING、TEXT、CHAR、UUID、CITEXT |
| 整數類 `int` | INTEGER、BIGINT、SMALLINT、MEDIUMINT、TINYINT |
| 浮點類 `flt` | FLOAT、DOUBLE PRECISION(sequelize 之 `DataTypes.DOUBLE.key`)、DOUBLE、REAL、DECIMAL、NUMBER |
| 其他 `other` | 其餘或 model 無型別 |

`procPk` 之補值型別檢查、`queryMemory` 之 CITEXT 改寫、`normPk` 共用此清單(修正前 `queryMemory` 缺 UUID,F8)。

### R-PK-02 `normPk(v, 類)` 之結果 `{kind, v}`

先拆包裝物件(`new String(x)`、`new Number(x)` 以 `valueOf()`)。

| 輸入 | `str` | `int` | `flt` | `other` |
|---|---|---|---|---|
| 非空字串(不計尾端半形空白 ≤255、無 NUL、良構 UTF-16) | ok(原樣) | 標準數字字串(`String(Number(s))===s`)且為整數→ok(數字);否則 mismatch | 標準數字字串→ok(數字);否則 mismatch | ok(原樣) |
| 非空字串 >255 字元(不計尾端半形空白) | cannot | 同上(必 mismatch) | 同上 | cannot(model 未定義主鍵欄時型別為 other,實體欄仍可能為文字) |
| 字串含 NUL 或孤立代理 | cannot | cannot | cannot | cannot |
| 有限數字 | ok(`String(v)`) | 整數→ok;非整數→mismatch | ok | ok |
| `''`、±Infinity、NaN、布林、物件、陣列、Date、BigInt、null、undefined | invalid | invalid | invalid | invalid |

### R-PK-03 各函數之處置

| 函數 | ok | invalid | mismatch | cannot |
|---|---|---|---|---|
| selectByPk | 以正規化值 `=` 查 | null(不初始化即回) | null | null,不送 Jet |
| insert / insertBulk | 寫正規化值 | T6:autoGenPk 且主鍵欄為字串類則補值,否則寫入前整批 reject | 寫入前整批 reject | 寫入前整批 reject |
| save | 寫正規化值 | 同上(T6) | 寫入前整批 reject | autoInsert 開啟:該筆 ok:0+err;關閉:n:0 ok:1;不送 Jet |
| del | 以正規化值 `=` 刪 | 該筆 ok:0+`invalid <pk>[…]` | 該筆 ok:0+err(型別不符) | `{n:0,nDeleted:0,ok:1}`,不送 Jet |
| select / delAll 之主鍵等值條件 | 以 Jet 判定命中列 | 肯定語境不命中;**否定語境(`$ne`、`$nin`)reject**(第 33 項批 2 後 `$not`、`$nor`、文件層 `$not` 已不在白名單,否定語境只剩此二) | 同 invalid | 肯定語境不命中;否定語境為必不相等 |

非運算子物件(如 `{}`)作為條件值即為無效主鍵值,不得使主鍵條件消失。

資料列於複本上就地改寫為正規化值(與 procPk 補值之既有作法一致),故 `change` 事件之 `data` 帶正規化值。

### R-PK-04 insert 撞鍵核對(F2)

撞 3022 者先以批次 `IN` 取存值,以 `kFast`(去尾端 U+0020 + 僅 ASCII A–Z 轉小寫)對應;對不上者於同一次 exe 往返逐筆以 `SELECT … WHERE 主鍵 = v` 由 Jet 判定,有列即已存在;仍無即撞他唯一索引而整批 reject。

### R-PK-05 select/delAll 之記憶體過濾(F3、F8、F9)

- 主鍵等值類條件(隱含等值、`$eq`、`$ne`、`$in`、`$nin`;第 33 項批 2 後已無陣列值與 `$not`)由 `castPkFind` 改寫為原列序號欄之 `$in`/`$nin`;序號由 `resolvePkIdx` 判定:先以全表存值之 `kFast` 對應,對不上者於單次往返逐筆 `SELECT … WHERE 主鍵 = v` 交 Jet,回傳之存值再對應序號。故命中判定與 selectByPk、del 完全一致(含 Jet 忽略增補平面字元、CURRENCY 之精度轉換等 JS 無從仿製者)。
- `castPkFind` **單趟走訪**:回傳 `{find, slots}`,序號條件之集合為佔位陣列(各 slot 含正規化後之主鍵值 `vals` 與佔位 `is`);`resolvePkIdx` 判定命中列後以 `fillPkSlots` 就地填入(聯集遞增;為空者填 `-1`)。每個條件值只讀一次,收集與改寫為同一次讀值。(原載「兩趟呼叫同一純函數:第一趟收集、第二趟改寫」→ 2026-10-16 run02 外審 opus [1]、sol [1] 改為單趟:兩趟讀值不一時〔覆寫 `valueOf` 之包裝物件、`getPrototypeOf` 會變之 Proxy〕,第二趟之值未經收集而查無序號,`$ne`/`$nin` 條件消失,delAll 刪光全表〔`tmp/run02/verify/opus-before.txt` P2-W1、P9;sol `probe-boundary.jsonl` box-ne-flip〕。)
- 主鍵衍生之序號條件**併入同一物件**(欄位 `wi` 之運算子物件 `{$in,$nin}`,不增巢狀層;第 33 項批 2 外審 sol F02 後;原為 Symbol `Op.and` 包覆〔reladb 1.1.10 起 Symbol 鍵 reject〕、再改字串鍵 `$and` 額外一層〔使合法深度放大〕),同運算子重複(如 `$eq` 與 `$in` 並列)才另以字串鍵 `$and` 置放;否定語境只剩 `$ne`、`$nin`(`$not`、`$nor`、文件層 `$not` 已不在白名單);空集合之 `$in` 以不存在之序號表示不命中,空集合之 `$nin` 不加條件(恆成立;白名單下呼叫端之空 `$nin` 已被拒收)。邏輯陣列之元素若其主鍵條件皆化簡掉(如 `$ne` 僅含不可能存在之值,必不相等即恆真),以恆真之序號條件 `{wi:{$nin:[-1]}}` 代替空物件(白名單拒空條件;外審 sol F01)。
- 範圍運算子(`$gt` 等)依記憶體 sqlite 比較(近似,見 L2;`$regex` 已於第 33 項批 2 移除)。**界限僅在 `normPk` 為 `ok` 時以正規化值留於原欄;`mismatch`/`cannot`/`invalid` 者原樣留於原欄,由 cvFind 依欄型比較或拒收**(第 79 項 run02,LW6 已解;見 R-FIND-03)。原為「整個子式改寫為恆假」,使 `k > 2.5`、`id < 'z'×300` 靜默回錯誤結果,於 `$and`/`$or`/同物件多運算子下更放大(`{$and:[{k:{$gt:1.5}},{k:{$lt:4.5}}]}` 回空而非 2,3,4)。
- 過濾表以亂數名之原列序號欄為主鍵(`genInnerKeys`,不與使用者欄位同名),結果取 Jet 原列並依序號排序(select 之內容即 Jet 原值,與 selectByPk 相同)。
- (原載「條件轉譯(`getUseFind`)本身之缺陷不在本規則範圍,待 cvFind 定案後移植」→ 2026-10-16 已移植,非主鍵條件之轉譯見 R-FIND。)

### R-PK-06 delAll 之刪除(F11)

帶條件之 delAll 以命中列之主鍵存值,於單次 exe 往返、交易包覆內逐筆 `DELETE … WHERE 主鍵 = v`;不用 `IN`(Jet 對長字串之 `IN` 與 `=` 不等價)。

### R-PK-07 importModels 之主鍵欄(F10)

`importModels` 只對 `opt.pk` 欄補 `primaryKey`;該欄已為主鍵或不存在者一律不寫檔;不對其他欄補主鍵。

### 已知限制(L)

| # | 內容 |
|---|---|
| L1 | 指數形式數字(≥1e21 或 <1e-6)於修正前寫入者,Jet 存為展開格式,修正後無法以同一數字命中 |
| L2 | select/delAll 之主鍵範圍運算子(`$gt`、`$gte`、`$lt`、`$lte`)依記憶體 sqlite 比較(字串欄 NOCASE),尾端空白、全半形等變體於邊界可能與 Jet 不一致(如 `{$gte:'K2 '}` 不含 `'k2'`);等值類條件不受影響 |
| L3 | delAll 之命中列若存值主鍵為 `''`(他方寫入)即整批 reject |
| L4 | 非主鍵字串欄之 select 等值依 sqlite NOCASE |
| L6 | Jet GUID 型別主鍵欄不支援 |
| L7 | DATETIME 主鍵欄不支援 |
| L8 | LONG 溢位與超過欄寬(≤255 字元)之主鍵不預檢,由 Jet 判定(讀取未命中、寫入失敗;insert 同批他列之部分寫入屬 T4 允許) |
| L9 | 浮點/定點主鍵欄(REAL、DECIMAL、CURRENCY、高精度 DOUBLE 如 `0.30000000000000004`)以精度外之值操作時:Jet 之 SELECT/DELETE 會轉換精度而命中,UPDATE 不轉換而不命中,故 save 重試 3 次後該筆 ok:0(資料不變);select/delAll/selectByPk/del/insert 之命中一致(外審 sol、opus 實測)。建議浮點主鍵只用可精確存放之值 |
| L10 | Jet 之 `=` 視為同鍵而 JS 字串相異者(大小寫、尾端空白、全半形、假名、`ß/ss`、忽略增補平面字元等)之寫入:insert 跳過、save 改寫既有列,存值維持既有者 |

### 破壞性變更紀錄(2026-10-16,待發布說明)

1. 字串主鍵欄之有限數字一律 `String(v)`;`change` 事件 `data` 之主鍵為字串。
2. ±Infinity、`new String('')`、`new Number(NaN)`、BigInt 為無效主鍵(依 T6 補值或 reject;select/delAll 不命中)。
3. 數值主鍵欄:標準數字字串轉數字;非標準字串、整數欄之非整數為型別不符(selectByPk null、寫入前 reject、del ok:0)。
4. select/delAll 之主鍵等值條件由 Jet 判定命中列:`delAll({id:'k2 '})` 會刪除 `'k2'`(與 del 一致);`$ne`/`$nin`/`$not` 不再刪除 Jet 視為同鍵之列。
4b. select/delAll 之主鍵否定條件(`$ne`、`$nin`、`$not`、文件層 `$not`/`Op.not`/`$nor` 內)含無效或型別不符之值(如 `undefined`)時 reject(修正前 sequelize 對 `undefined` 亦 reject;若依「不命中」推得全部命中,delAll 會清空全表);肯定條件之無效值不命中;`{id:{}}` 不命中。
5. select 之回傳改為 Jet 原列:DATE 欄為 Jet 原值字串(如 `2026-10-14T08:30:15`)、BOOLEAN 欄為 `true`/`false`;順序為 Jet 回傳序。
6. >255 字元、含 NUL、孤立代理之字串主鍵視為不可能存在。

### 對應測試

| 規則 | 測試 |
|---|---|
| R-PK-01、02 | `test/unit-pkvariant.test.mjs` 之〈normPk 純函數〉 |
| R-PK-03 | 同檔〈字串主鍵之數字〉〈數值主鍵欄〉〈不可能存在之主鍵〉〈無效值〉〈包裝物件與 BigInt〉 |
| R-PK-04 | 同檔〈Jet 等值變體 × 七函數〉〈同批變體重複〉〈撞他唯一索引〉〈長字串主鍵〉 |
| R-PK-05 | 同檔〈Jet 等值變體 × 七函數〉(含 JS 可折疊而 Jet 相異、Jet 忽略增補平面字元、`{id:{}}`)〈否定與等值運算子〉〈model 邊界與內部欄名〉(含 CURRENCY)〈UUID 主鍵〉〈select 與 selectByPk 內容相同〉 |
| R-PK-06 | 同檔〈長字串主鍵〉(delAll 兩案各自獨立) |
| R-PK-07 | 同檔〈opt.pk 非 id〉〈model 邊界〉之補標主鍵案 |
| T6 之 0 為有效主鍵 | `test/unit-autogenpk.test.mjs`〈主鍵值為數值0者視為有效而不補值〉 |
| 全矩陣 | `node tmp/audit01/probe/p2-matrix.mjs S I D` + `gen-matrix.mjs`(審計工具,不入版控) |

測試資產:`node toolg/genTestMdbAssets.mjs worm_pk_def.mdb` 產生 `test/assets/worm_pk_def.mdb`;model 於 `test/assets/models/`;測試時複製到 `./test/temp-pkvariant/` 再用。

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

## R-LIFE 實例生命週期:sequelize 之持有與關閉(2026-10-20,第 79 項③;LW7 已解)

- `initAdodb` 回傳之實例**自帶**其 sequelize(區域變數),`close` 只關閉**自己的**,以旗標保證冪等;不再有實例層(閉包)共用之 `sequelize` 變數,也沒有共用的 `closeSequelize`。
- 7 個函數之 `finally` 改為 `await si.close()`,條件不變(`select`/`delAll` 為 `inited`,其餘為 `instance === null`);壞 find 不初始化(R-WL-01)不變。
- `initSequelize`(`queryMemory.mjs`)匯入 model 失敗時,先關閉自己剛建的 sequelize 再 reject(原每次失敗漏關 1 個)。
- 事實(審計 run01):被漏關的僅 Sequelize 物件(主實例只 `importModels` 取 `rawAttributes`,從未查詢,故從未開啟 sqlite3 連線;真正開連線的是 `queryMemory` 內每次呼叫自建並於 `finally` 關閉之實例),sqlite3 連線開 = 關(39 格全測)、無行程、可自行結束、GC 後堆積不成長;原漏關數 = 並行數 − 1。
- 關閉語意:`close` 後 `mds` 之 `rawAttributes` 仍可讀(不查詢),但文件載明「close 後不再使用」;`pmq`(模組層佇列)不動。

## R-FLOAT 非主鍵日期條件:浮動時間(2026-10-21 立;排程第 87 項、第 94 項任務 B4;來源:審計 `C:\opensrcOper\dnow\20261021080241\agent-out\run01-審計與方案.md` §4、§5.2;w-orm-reladb 1.1.14 帳本 R14;`LF4`、`LF8` 已解)

### R-FLOAT-00 單一規則

Jet 之 DATETIME 是**無時區牆上時間**(`select` 回傳 `2026-01-01T00:00:00`,無夏令、無偏移)。記憶體過濾表(`queryMemory.mjs`)內 DATE 欄之值與條件值**同處「浮動空間」**:牆上時間分量作為 UTC 瞬間存/比。故日期條件之命中 = **牆上時間之數值比較**,不受夏令正規化與負偏移時區之 UTC 年位移影響。**限定**:「與主機時區無關」只適用**條件值本身就是牆上分量**者(無時區字串);**固定瞬間**之條件(Date、epoch、帶 `Z`/偏移之字串)先得瞬間再取其於主機時區之本地分量,故同一瞬間在不同主機時區對應到不同的牆上列(設計:Jet 無時區,與 Jet 寫入 Date 時取本地分量一致;LFL2)。

- 條件側:`cvFind(find, { attrs, dateNoTz: 'floating' })`(reladb 1.1.14)。無時區字串(`yyyy-MM-dd[T 或單一空白]HH:mm[:ss[.小數]]`)直接取其分量;Date、epoch、帶時區之 ISO 字串先得瞬間,再取**主機本地分量**(`new Date(2026,0,1)` 即 `2026-01-01 00:00:00` 之浮動值,與主機時區無關);純日期字串 reject(同前)。
- 資料側:`queryMemory.mjs` 建 `rows` 時,DATE 欄之值經 reladb 匯出之 `toFloating` 換算(同一函數、同一規則)。
- 對標:主流資料庫/驅動(PostgreSQL `timestamp without time zone`、MySQL `DATETIME`、Oracle `DATE`)皆回傳不帶時區之 naive 值並以 naive 比較;把牆上分量當作 UTC 瞬間存放與比較即「naive 視為 UTC」,與該慣例一致,也是 Npgsql/NodaTime(`LocalDateTime`)把牆上時間與瞬間分型別的對應作法之簡化(本案以 JS `Date` 的 UTC 分量承載,故須守住「編碼後之 Date 不外洩、不二次輸入」,R-FLOAT-01①)。PostgreSQL 對 timestamp-without-tz 字面值是**忽略**輸入文字中的時區標記,本案則對帶時區字串先得瞬間再取主機本地分量(reladb 已選之契約,非本套件決定)。
- DATE 欄之判定:條件側(cvFind)與資料側同用 reladb 之 `getColKind(attrs, 欄) === 'date'`(單一擁有者;不以 `instanceof Sequelize.DATE` 另判,以免兩份 sequelize〔LF1〕時兩側認定不一致)。
- 單一擁有者:換算規則(`toFloating`、`dateNoTz:'floating'`)在 reladb;本套件**不得另寫日期解析**,也不得於 cvFind 前後改寫條件值(R-FIND-00)。資料側之換算與條件側之 `'floating'` **必須同進同退**(同在 `queryMemory.mjs` 同一函數)。
- 盤點(行號會漂移,以指令為準):`rg -n "dateNoTz: '" src/` → `queryMemory.mjs` 之 1 處(值 `'floating'`);`rg -n "toFloating\(" src/` → 1 處;`rg -n "dateNoTz: 'local'" src/` → 0(`queryMemory.mjs` 說明文字提及修前之 `'local'` 屬歷史註解,不計);`rg -n "cvFind\(" src/` → 仍只 `queryMemory.mjs` 之 1 處(R-FIND-00)。

### R-FLOAT-01 契約(reladb R14①–④ 在本套件之落實)

| reladb 契約 | 本套件作法 | 測試 |
|---|---|---|
| ① 編碼後之浮動 `Date`/epoch 不可再當 `'floating'` 條件輸入 | `queryMemory` 回傳 **Jet 原列**(字串),記憶體表之 `Date` 不回傳亦不回灌;條件一律取自呼叫端之原始 find | `unit-float-tz`〈select 之內容仍為 Jet 原值〉 |
| ② `toFloating` 回 `null` 者呼叫端須整批拒收,不得以原值或 NULL 代入 | 資料列任一 DATE 欄值(`null`/`undefined` 除外)得 `null` → `throw invalid data: date can not be converted to floating time at [row[i].欄]`(不回顯值),select/delAll 整批 reject(經既有 catch 發一次 `error`)、資料表不變 | `unit-float-tz`〈轉換失敗整批拒收〉21 種值 × 3 時區 × 3 位置 × 3 種 find |
| ③ 接受文法即設計語意 | 字串值取 Jet 回傳形式(`yyyy-MM-ddTHH:mm:ss`,毫秒非 0 時 `.fff`);`Date`/epoch 資料值(Jet 不會回傳,防禦)依同一規則 | `unit-float-tz`〈非字串之有效 DATE 值〉 |
| ④ 條件側 `'floating'` 與資料側 `toFloating` 同進同退 | 同在 `queryMemory.mjs`;DATE 欄判定兩側同源(`getColKind`) | 變異 M1/M2/M10/M11 |

### R-FLOAT-02 軸(輸入空間表)

| 軸 | 成員 |
|---|---|
| 時區(10) | Asia/Taipei、UTC、Asia/Kolkata、Pacific/Kiritimati〔UTC+ 無夏令〕、America/Los_Angeles、America/New_York、America/Sao_Paulo、Etc/GMT+12〔負偏移〕、Europe/Berlin、Australia/Lord_Howe〔UTC+ 有夏令/半小時跳時〕;每個時區先經 `tzProof` 自證(本地 getter 偏移 = ICU 偏移,冬夏各一;負偏移者 9999-12-31 23:59:59 之 UTC 年為 10000),避免名稱打錯而靜默落到 UTC |
| 資料列(26,queryMemory 層) | 一般日期 7、哨兵 3(`9999-12-31` 00:00/12:00/23:59:59)、年 100 兩個、Jet 時間值基準日 `1899-12-30T08:30:00` 1 個、美東夏令跳過/重疊 6 個、柏林跳過/重疊 4 個、Lord Howe 跳過/重疊 2 個、NULL 1 個 |
| 條件值(25 個〔值, 形式〕配對,非 25 值 × 3 形式的完整交叉)| 無時區字串 15(含哨兵、跳過/重疊時刻本身)、以本地分量建構之 `Date` 8、其 epoch 2 |
| 條件文法(另組,69 格 × 4 時區) | 23 個字串 × `$eq/$lt/$gt`:省略秒、空白分隔、小數 1–4 位〔取前三位截斷〕、年 0001/0050/0099/0100、閏日、哨兵含毫秒;預言機另行解析文法 |
| 固定瞬間(另組,81 格 × 7 時區) | 9 個瞬間 × {帶 `Z`/`+hh:mm`/`+hhmm`/`-hh:mm` 之字串、`Date`、epoch} × `$eq/$lt/$gt`;預期牆上時間取自 ICU(`Intl`),列為該牆上時間及前後一小時;含美東夏令切換日與重疊之第二次 01:30、Lord Howe 切換日 |
| 欄型 | DATE(換算)、DATEONLY(不換算;合成純日期值維持原值,真 Jet 日期時間於 sqlite 內被截為日期)、STRING(不換算不檢核)、其他白名單欄型(str/int/num/bool)、**非白名單欄型**(`getColKind` 歸 `any`:TIME、ENUM、JSON、JSONB、BLOB、UUIDV1、UUIDV4、NOW、ARRAY、RANGE、GEOMETRY、GEOGRAPHY、HSTORE、INET、CIDR、MACADDR、TSVECTOR;**條件引用即拒收**,R-FLOAT-07) |
| 安裝佈局 | 單一 sequelize(全矩陣)、reladb 帶巢狀 sequelize 副本(`unit-float-twocopy`:`getColKind` 以 `type.key` 補判) |
| 運算子 | `$lt $lte $gt $gte $eq $ne` + `$in/$nin`(元素同套用) |
| 預言機 | 牆上時間字串逐欄轉 UTC 分量之數值比較(Jet 語意:無時區、無夏令),與主機時區及受測碼皆無關;`Date`/epoch 條件取結果 Date 之本地分量(夏令跳過之時刻建構時已被 JS 正規化) |
| 層 | queryMemory 層(無 Jet,全矩陣)、公開 API 層(真 Jet,6 時區:LA、New_York、Sao_Paulo、Etc/GMT+12、Berlin、Taipei × 9 條件 × 4 運算子 + `delAll($lt 今日)` + 哨兵作條件值 + 哨兵 `delAll`) |

### R-FLOAT-03 行為變動(相對修前,'local')

1. 負偏移時區:範圍條件結果錯誤(修前 156 格中 102–106 格錯)與哨兵作為條件值被拒(`does not match column type [date]`)皆消失;`delAll({d:{$lt:今日}})` 不再誤刪 `9999-12-31 23:59:59` 列(**資料遺失類缺陷已解**)。
2. 夏令時區(含 UTC+ 之柏林、Lord Howe):夏令跳過之牆上時刻原樣比較(修前被正規化,柏林 16/156、Lord Howe 14/156 格錯);重疊時刻不再「取較早者」(LF4 已解);跳過時刻可作為條件值(修前被拒)。
3. 無夏令之 UTC+ 與 UTC 時區:對有效 Jet 資料結果不變。
4. 新增拒收:model 宣告 DATE 而資料表欄實為任意文字(或其他無法換算之值)時,**任何經記憶體過濾表之 select/delAll**(含條件不涉及該欄者,**亦含不帶條件之 `select()`**:`findAll` 對全表與帶條件走同一路徑)整批 reject `invalid data: date can not be converted to floating time at [row[i].欄]`。修前該值入表後成為**文字 `Invalid date`(非 NULL,`IS NULL` 不命中)**,其字典序大於數字開頭之日期文字,故 `$gt`/`$gte`/`$ne` 會命中它而 `delAll` 會刪除之(第 87 項 B4 外審 minimax F-17 提出、本批 `tmp/probe-head.mjs` 對 HEAD 之 `queryMemory` 實證:列 `bad`〔`'garbage'`〕於 `$gte 2000`、`$gt 2099`、`$ne 2020` 皆命中,Taipei 與 LA 同;若改以 NULL 代入則 `IS NULL` 命中,同樣危險)——fail-closed 同時消除這兩條路徑;修前不帶條件之 `select()` 回傳全部列不受影響,現亦 reject(**fail-closed 取捨,待主控確認**:替代作法為空條件時略過換算,但需對 DATE 欄代入 NULL 以免 `bulkCreate` 失敗,與契約②字面衝突,故未採)。不帶條件之 `delAll()` 走 `DELETE FROM`(R-WL-02),不經記憶體過濾,不受影響。條件值本身不合法者(如 `{fStr:'garbage'}` 作用於 DATE 欄)由 cvFind 先行拒收(`invalid find`),先於資料列換算。`select`/`delAll` 對空表不受影響(無列可換算)。
5. 條件值 Date 之牆上年:`Date`/epoch 取本地分量,牆上年須在 1–9999(reladb);Jet 不可能存在年 < 100,條件側放寬無害(寫入側仍受 R-DATE 年 100–9999 守門)。

### R-FLOAT-04 回退順序

本套件靜態 `import { toFloating, getColKind }` 自 `w-orm-reladb/src/cvFind.mjs`:回退須**先退本套件、後退 w-orm-reladb**;`package.json` 下限 `w-orm-reladb ^1.1.14`。

### R-FLOAT-05 已知限制(LFL)

| # | 內容 |
|---|---|
| LFL1 | 純日期字串條件(`'2026-01-01'`)仍 reject(reladb 不收;dspec 可攜寫法為帶時間之字串) |
| LFL2 | `Date`/epoch/帶時區字串條件以**主機本地分量**為牆上時間(與 Jet 寫入 Date 時取本地分量一致);跨主機時區傳遞同一瞬間之 epoch,其牆上時間隨主機時區而異(設計:Jet 無時區) |
| LFL3 | 資料側非字串之 DATE 值(`Date`、epoch)依同一規則視為瞬間取本地分量;Jet 經橋接只回傳字串,此為防禦行為,不在實際路徑上 |
| LFL4 | 表不含任何列時不換算(無資料);`select`/`delAll` 結果為空,行為同前 |
| LFL5 | **已解(B4 run02 TIME;run03 擴為全 `any`,R-FLOAT-07)**:model 把 Jet 之 DATETIME 欄宣告為 TIME 時,reladb `getColKind` 為 `any`,不換算、不檢核,條件依 sqlite 文字比較(Jet 對時間值回傳 `1899-12-30T08:30:00`,sqlite 比完整文字與 `'12:00:00'`),`delAll({dt:{$gt:'12:00:00'}})` 會刪除早於 12:00 之列(第 87 項 B4 外審 sol F01 於真 Jet 實證:8:30 與 20:30 兩列皆被刪,原生 Jet 比較只命中 20:30;`$lt:'12:00:00'` 則反而漏掉 8:30)。現於條件引用 TIME 宣告之欄時一律拒收 |
| LFL7 | **已解(B4 run03,方案 A,R-FLOAT-07)**:條件引用 `getColKind` 為 `any` 之欄(全集 17 型別,含 TIME)一律拒收,不再多刪;以下為原問題(保留作證據):**TIME 以外之 `any` 型別**(reladb `getColKind` 歸 `any`):ENUM、JSON、JSONB、BLOB、UUIDV1、UUIDV4、NOW、RANGE、HSTORE、INET、CIDR、MACADDR、TSVECTOR 宣告於 Jet 欄時,值不換算、不檢核,記憶體表欄型亦不是 CITEXT,故(真 Jet 實測 `tmp/probe-any.mjs`,B4 run02 報告 §3):**宣告於文字欄**——字串比對**分大小寫**(Jet 不分):`{name:{$ne:'APPLE'}}` 多命中 `apple`(delAll 多刪)、`{name:'APPLE'}`、`$in` 漏命中;**宣告於日期時間欄**——空白分隔之日期時間字串與 Jet 回傳之 `T` 分隔文字比較,`$eq` 漏命中、`$ne` 多命中(delAll 多刪);**宣告於 DOUBLE 欄之 ENUM、BLOB**——數值依文字序比較(`{value:{$gt:9}}` 漏掉 10、100,`$lt:50` 多命中 100)。ARRAY、GEOMETRY、GEOGRAPHY 於 sqlite 方言建表/寫入即失敗(`values.map is not a function`、`GeometryType undefined not supported`),`select()` 與任何條件皆 reject(fail-closed,但訊息為 sequelize 內部字樣)。其中真實可能之誤用為 ENUM 宣告於 TEXT 欄、JSON 宣告於 MEMO 欄、BLOB 宣告於 OLE 欄;現皆須改宣告為 STRING/TEXT 才可作為條件(破壞性,README 已載)。ARRAY/GEOMETRY/GEOGRAPHY 之**不帶條件 `select()`** 仍因 sequelize sqlite 方言建表失敗而 reject(訊息為 sequelize 內部字樣,範圍外,未處理) |
| LFL8 | **model 把 Jet 之 DATETIME 欄宣告為 STRING 或 TEXT**(`getColKind` 為 `str`,非 `any`,故不受 R-FLOAT-07 管轄):條件值須為字串,以 CITEXT 文字比較,同 LFL7 之日期時間欄:空白分隔字串 `$eq` 漏命中、`$ne` 多命中(delAll 多刪)(`tmp/probe-any.mjs extra` 實測)。屬 LD5 之同族(model 須如實宣告為 DATE),**未修**;根治為方案 C(`connMDB.exe` 回傳實際欄型、與 model 宣告比對,主控另立後續),亦可一併封住 LD5 |
| LFL6 | **model 把 Jet 之 DATETIME 欄宣告為 DATEONLY**:不換算(`getColKind` 為 `dateonly`);條件值須為純日期字串(帶時間者 reladb 拒收),資料側由 sequelize 截為日期粒度比較,select 仍回傳 Jet 原值(完整日期時間字串)。此為既有行為(非浮動時間規則管轄),外審 minimax 於真 Jet 實測同日 08:30、20:30 兩列皆命中 `{dt:'1899-12-30'}`;本批無真 Jet 之 DATEONLY 測試,僅有合成純日期之單元案 |

### R-FLOAT-06 對應測試與變異

| 規則 | 測試 |
|---|---|
| R-FLOAT-00、01、02(queryMemory 層全矩陣) | `test/unit-float-tz.test.mjs`(10 時區各 25 個〔值, 形式〕配對 × 6 運算子 + 3 組 `$in/$nin` = 156 格〔格數為斷言之固定常數〕;條件文法 69 格 × 4 時區;固定瞬間 81 格 × 7 時區;哨兵 `delAll`/select 三種形式;哨兵作條件值;自證負偏移;每列自身作 `$eq` 命中自己;資料側 null/undefined、轉換失敗 21 種值〔完整標準訊息相等,任何型別之壞值不得被回顯〕、非字串有效值、多 DATE 欄、含毫秒值、非 DATE 欄〔字串欄、DATEONLY 之合成純日期〕不受影響、回傳列序 = 輸入序、拒收原因先後〔條件 × 資料 2×2 交叉〕) |
| R-FLOAT-00(重複安裝佈局) | `test/unit-float-twocopy.test.mjs`(於 `test/_tmp/float-twocopy/` 建 reladb 帶巢狀 sequelize 副本之佈局,子行程驗兩份 sequelize 身分不同、`getColKind` 以 `type.key` 補判、3 時區之哨兵/Date/epoch/多 DATE 欄/IS NULL) |
| R-FLOAT-00、03(公開 API,真 Jet) | `test/unit-float-e2e.test.mjs`(6 時區;種子 8 列含哨兵、年 100、美東/柏林夏令跳過、美東重疊、NULL;`delAll($lt 今日)` 剩餘列、select = delAll 集合、36 格條件 × 運算子之 select〔6 時區,格數為斷言之固定常數〕與**逐格 delAll**〔LA、Berlin、Taipei:實刪集合自 Jet 讀回剩餘主鍵取差集,與預言機相等、回傳筆數 = 實刪列數〕、哨兵作條件值〔字串/Date/epoch〕、哨兵 `delAll`) |
| R-FLOAT-02(公開 API,真 Jet 之換算失敗) | 同檔末組:model 把 Jet TEXT 欄宣告為 DATE 並存入亂字串,4 種 find 之 select 與 delAll(含不涉及該欄者)整批 reject、表不變、每次呼叫恰一次 `error` 事件、訊息指出欄位且不回顯值;不帶條件之 `select()` 同樣 reject;欄值改為可換算之牆上時間後範圍條件(含哨兵)於 LA 與 Taipei 照常 |
| R-FLOAT-07(TIME 宣告欄之條件拒收,真 Jet) | `test/unit-find-coltype.test.mjs` 第一組(B4 run02 起):model 把 `tc.dt` 宣告為 TIME;22 種引用該欄之條件〔等值/各運算子/`$in`/`$nin`/`$in:[]`/null/數值/布林/Date/同欄多運算子/與他欄或主鍵並列/`$and`/`$or`/巢狀〕× select 與 delAll,逐一斷言 reject、完整訊息相等〔含路徑〕、每次恰一次 `error` 事件、無 `change` 事件、資料表不變;資料庫檔不存在時仍得欄型訊息且不創建檔案〔證明先於任何讀取〕;拒收次序(形狀層 → 欄型 → cvFind);`option.instance` 同;不引用該欄者〔`select()`、`delAll()`、他欄/主鍵/`$or`/`$and` 條件〕不受影響;同一表改宣告 DATE 則與 Jet 原生比較一致 |
| R-FLOAT-07(17 個 `any` 型別,真 Jet) | 同檔第二組(B4 run03):TIME、ENUM、JSON、JSONB、BLOB、UUIDV1、UUIDV4、NOW、ARRAY、RANGE、GEOMETRY、GEOGRAPHY、HSTORE、INET、CIDR、MACADDR、TSVECTOR 各一案(型別表格數為斷言常數 17):model 把 `name`、`value`、`dt` 三欄皆宣告為該型別,以修前會多命中(多刪)之條件〔`name $ne 'APPLE'`、`value $lt 50`、`dt $ne '2026-05-01 10:00:00'`〕+ 巢狀 `$or`,select 與 delAll 皆 reject、訊息帶該型別名稱且與路徑完全相等、error 事件逐次累計、無 `change`、資料表 4 列不變;前提案以 Jet 原生 SQL 證明三條件之正確命中集合;另 ENUM 宣告三欄時以 `n`/`b`/`id` 為條件照常且 `delAll` 只刪命中者;VIRTUAL 欄不在此判(仍得 `unknown column name`) |
| R-FLOAT-07(白名單欄型對照,真 Jet) | 同檔第三組:17 個白名單欄型〔STRING TEXT CHAR CITEXT UUID 於 `name`;INTEGER BIGINT SMALLINT MEDIUMINT TINYINT 於 `n`;DOUBLE FLOAT REAL DECIMAL NUMBER 於 `value`;BOOLEAN 於 `b`;DATE 於 `dt`〕共 67 個條件,select 命中集合 = Jet 原生 WHERE 命中集合;delAll 於 STRING/INTEGER/DOUBLE/DATE 各取一個多命中風險之條件,實刪集合 = Jet 原生;DATEONLY 宣告於 DATETIME 欄之純日期條件被接受(LFL6) |
| R-FLOAT-07(`chkFindColKind` 純函數) | 同檔第四組:17 個 `any` 型別(真正之 `rawAttributes`)各自被拒且訊息帶型別名;20 個白名單欄型(含 `STRING(10)`、`TEXT('tiny')`、`DECIMAL(10,2)`)不拋;資料庫欄名(`field`)引用、巢狀路徑含陣列索引、鍵序(回報第一個)、屬性名優先、不引用者不拋、VIRTUAL 不判、只有 `type.key` 之手造 attrs、無 type 或 key 異常者視為 `unknown`、不改動輸入、不回顯值 |
| 時區工具 | `test/tools/floatTools.mjs`(`tzProof`、預言機)、`test/tools/withTz.mjs` |
| 全套另跑 | 預設時區 = 基準;`TZ=PST8PDT` 啟動一次(Windows 啟動時 POSIX 名生效) |

變異(2026-10-21 第 87 項 B4 最終一輪;`tmp/mutate.mjs`,於 `tmp/mut/<名>/` 副本套用;對照 `M0-none` 全綠;**24 個全數轉紅、存活 0**):

| 群組 | 變異 | 轉紅處 |
|---|---|---|
| 條件/資料同進同退 | M1 條件改回 `'local'`(19 紅)、M2 拿掉資料列 `toFloating`(21)、M12 資料列改 `new Date(x)`(43)、M13 兩者併(修前等價,38)、M10 DATE 欄判定恆空(43)、M7 只換第 0 列(42)、M11 只換第一個 DATE 欄(2) | `unit-float-tz` |
| 失敗/空值處置 | M3 轉換失敗回填原值(25)、M4 NULL 代入(25)、M5 null/undefined 不略過(16)、M6 undefined 不略過(1)、M8 Date/epoch 資料值不換算(11)、M9 訊息回顯值(22)、S2 非字串壞值回顯(10) | `unit-float-tz`(M3/M4 另含 `unit-float-e2e`) |
| 時序/列序 | S1 cvFind 移到資料換算之後(1,2×2 交叉案)、S3 回傳依 id 排序(1,列序案) | `unit-float-tz` |
| reladb 端(副本內改套件) | R1 帶時區字串丟棄時區(1)、R2 無時區字串必須含秒(1)、R3 小數秒必須恰三位(1)、R4 條件側年下限收窄為 100(1)、R5 分類只用 `instanceof`(1,**僅 `unit-float-twocopy` 紅**) | `unit-float-tz`、`unit-float-twocopy` |
| 公開 API(delAll) | S5 delAll 把 `$eq` 改 `$ne`(7)、S6 delAll 吞掉 `findAll` 之拒收(1) | `unit-float-e2e` |
| 修前 | HEAD 之 `queryMemory.mjs` 全文(56 紅 / 70 案) | 全部 |

首輪外審前之測試曾使 S1、S2(非字串)、S3、S5、S6、R1–R5 存活(sol 外審 F02–F09 實證),補測後轉紅。等價變異:queryMemory 資料側改 `instanceof Sequelize.DATE`(mdb 側 model 與 `Sequelize` 同一份,兩份佈局下仍正確)。

### R-FLOAT-07 條件引用非白名單欄型之欄:一律拒收(2026-10-21 B4 run02 立〔TIME〕,run03 擴為全 `any`〔方案 A〕;原 LFL5、LFL7;主控裁示)

**規則**:model 把某欄宣告為**非白名單欄型**時,`select(find)` 與 `delAll(find)` 之 `find` 只要**引用該欄**(任何運算子與值形式、含 `null`、含 `$and`/`$or` 巢狀、屬性名或資料庫欄名〔`attr.field`〕皆算),一律整批 reject `invalid find: column type <型別> is not supported at [find.<路徑>]`。

- **白名單欄型** = reladb `getColKind` 分類為 `str`(STRING、TEXT、CHAR、CITEXT、UUID)、`int`(INTEGER、BIGINT、SMALLINT、MEDIUMINT、TINYINT)、`num`(FLOAT、REAL、DOUBLE、DECIMAL、NUMBER)、`date`(DATE)、`dateonly`(DATEONLY)、`bool`(BOOLEAN)者,即 Jet 欄型可對應者。**非白名單** = `getColKind` 歸 `any` 者(17 個可宣告為欄之型別):TIME、ENUM、JSON、JSONB、BLOB、UUIDV1、UUIDV4、NOW、ARRAY、RANGE、GEOMETRY、GEOGRAPHY、HSTORE、INET、CIDR、MACADDR、TSVECTOR。VIRTUAL(歸 `any`)非資料庫欄,**不在此判**,交 cvFind 以 `unknown column name` 拒收。
- **理由**:Jet 欄型只有文字、數值、日期時間、是否等,沒有上列型別(TIME 更無[僅時間]型別),於 mdb model 宣告者必為誤宣告或無法對應;reladb `getColKind` 將其歸 `any`(不換算日期、不檢核值型別),記憶體過濾表之欄亦不是 CITEXT,條件交 sqlite 比較而與 Jet 原生不同(真 Jet 實測 `tmp/probe-any.mjs`):文字欄分大小寫(`$ne 'APPLE'` 多命中 apple)、日期時間欄依文字比較(空白分隔與 `T` 不等,`$ne` 多命中)、TIME 之 `$gt '12:00:00'` 多刪、ENUM/BLOB 於 DOUBLE 欄依文字序。錯誤方向為多命中者即 `delAll` 多刪之資料遺失路徑。fail-closed 優於靜默錯刪;**不改寫條件**(R-FIND-00)。正確作法是如實宣告為白名單欄型(Jet DATETIME 宣告為 DATE,時間值以 1899-12-30 為日期,與 Jet 原生比較一致,`unit-find-coltype` 第一組第 5 案)。
- **固定詞彙、不回顯值**:訊息只含固定句、型別名與路徑。路徑含呼叫端自己給的欄名與 `$and`/`$or` 索引,格式同 cvFind 之 `find.欄名`;**型別名取自 model 之 `type.key`(非條件值),仍以 `^[A-Z][A-Z0-9 _]{0,31}$` 過濾,不合者(無 type、key 非字串或含異常字元)固定為 `unknown`**。
- **先於任何讀寫**:`chkFindColKind(attrs, find)`(`queryMemory.mjs` 匯出;run02 之 `chkNoTimeCol` 改名)由 `WOrmMdb.mjs` 之 `findAll` 於 `getMd` 之後、`jet.query` 讀全表之前呼叫。`select`、`delAll` 皆經 `findAll`(帶條件者),故行為一致;拒收時不開啟資料庫檔(`unit-find-coltype` 以不存在之檔證明)、不讀、不刪、不發 `change`,經既有 catch 發一次 `error`。
- **不受影響**:不引用該欄者——不帶條件之 `select()`、`delAll()`(後者走 `DELETE FROM`)、同表其他欄與主鍵之條件;白名單欄型之條件全數照常(`unit-find-coltype` 第三組對照 Jet 原生)。**例外(範圍外)**:ARRAY、GEOMETRY、GEOGRAPHY 於 sequelize sqlite 方言建表即失敗,含此類欄之 model 其不帶條件 `select()` 仍 reject(sequelize 內部字樣),修前亦然。
- **次序**:形狀層(`normFind`,先於初始化)→ **欄型檢核**(model 已載入、未讀全表)→ 主鍵改寫與全表讀取 → `cvFind`(欄名、值型別)。故一個條件同時含非白名單欄與不存在之欄者,得欄型訊息。
- 欄位解析:屬性名完全相符優先,否則以資料庫欄名完全相符(多個命中者任一為 `any` 即拒);歧義與不存在者不在此判(留給 cvFind 之嚴格鍵拒收)。以 `getColKind`(其內 `instanceof` 外另有 `type.key` 後備)判定,不自寫 `instanceof`(重複安裝兩份 sequelize 時 `instanceof` 為假,同 LF1/R-FLOAT-00);不另維護型別清單(reladb 為單一擁有者;其新增型別分類時本套件自動隨之)。
- **`genModelsByTabs` 是否會產出這些型別**:`genModelsByTabs(fd, tabs)`(reladb 實作,本套件僅轉呼叫)的型別字串完全由呼叫端在 `tabs` 給定(`{表名: {欄名: 'TIME'}}` → `DataTypes.TIME`),不依 Jet 欄型推導,也**沒有**型別白名單;故只有呼叫端明寫才會產生。本套件無 `genModelsByDB`(不能由 Jet 反推欄型)。
- **未解(方案 C,另立後續)**:model 宣告之型別與 Jet 實際欄型不符、但宣告型別屬白名單者(如 STRING/TEXT 宣告於 DATETIME,LFL8;DOUBLE 宣告於文字欄等)不在本規則範圍;根治需 `connMDB.exe` 回傳實際欄型(OleDb schema)並與 model 宣告比對。
- 盤點(行號會漂移,以指令為準):`rg -n "chkFindColKind" src/` → `queryMemory.mjs` 定義、遞迴與匯出,`WOrmMdb.mjs` import 與 `findAll` 內呼叫 1 處;`rg -n "chkNoTimeCol" .` → 僅 `sgud/exp/experience.md`、本帳本之歷史敘述與 `tmp/`。
- 變異(B4 run03;`tmp/mutate-coltype.mjs`,副本於 `tmp/mut/<名>/`;對照 C0 38/38 綠;**37 個全數轉紅、存活 0**):
  - 呼叫/次序(4):C1 不呼叫(21 紅)、C2 移到讀全表之後(1)、C3 移到 `queryMemory` 之 `cvFind` 之後(2)、C11 吞掉拋出(21)。
  - 走訪/解析(6):C5 不遞迴(21)、C6 只遞迴 `$and`(20)、C7 不解析資料庫欄名(1)、C8 只檢每層第一個鍵(3)、C9 路徑不含陣列索引(21)、C12 VIRTUAL 亦在此拒收(2)。
  - 訊息(2):C10 回顯條件值(25)、C13 型別名不過濾直接回顯(1)。
  - 範圍(2):C4 退回只拒 TIME(19)、C14 any 一律放行(25)。
  - **白名單放寬一個型別(17)**:A-relax-TIME(9 紅)、ENUM(4)、JSON、JSONB、BLOB、UUIDV1、UUIDV4、NOW、ARRAY、RANGE、GEOMETRY、GEOGRAPHY、HSTORE、INET、CIDR、MACADDR、TSVECTOR 各 2 紅(真 Jet 逐型別案 + 純函數 17 型別案)。
  - **收緊一個白名單分類(6)**:B-tighten-str(27)、int(6)、num(3)、date(7)、dateonly(2)、bool(3),由第三組對照組與純函數 20 個白名單欄型案殺。
  - 修前紅:`chkFindColKind` 實作前(run02 工作樹)跑本檔 38 案 **24 紅**(16 個 any 型別之真 Jet 案——除 TIME 外皆紅,TIME 已於 run02 修;純函數組 8 案),14 案綠(第一組 TIME 6 案〔run02 已修〕;第二組 5 案:前提、型別表格數、TIME 逐型別案、不受影響、VIRTUAL;第三組白名單對照 3 案)。純函數組 8 案因函數尚不存在全紅。
- run02 之 TIME 專屬變異(T1–T14,13 個,存活 0)與修前紅(8/11)見 `agent-out/mdb-run02-修正報告.md` §5、§6;其測試已併入 `unit-find-coltype` 第一組。

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

## R-DIAG 診斷輸出之單一出口與預設安全(2026-10-28 立;mdb-run01;同日 mdb-run02 移除 `withDiagConsole`〔不替換全域 console〕、依賴下限升至 w-orm-reladb ^1.1.17;來源:第 153 項〔同型之個資輸出〕、w-serv-orm 1.1.20 `getDiag`、w-orm-reladb 1.1.16 `getDiag`/`maskUrl` 及其 reladb-run01/run02 報告;主控定:選項名稱與語意比照 w-serv-orm,各套件自行實作,不抽到 wsemi)

### R-DIAG-00 單一擁有者與站點全集

- 單一擁有者:`src/getDiag.mjs`(`getOptLog`、`getSecrets`、`maskText`、`maskUrl`、`maskDialect`、`cpMask`、`getDiag`、`getBriefErr`、`getSqlStmt`;不 import 任何模組〔含 Node 內建〕,dist 由 rollup 打包)。**`src/` 內除本檔外不得直接呼叫 `console`、`process.stdout/stderr`、`emitWarning`**,傳給 sequelize 之 `logging` 只能是函數或 `false`。
- 站點全集(改動前 `file:line` 為 HEAD 92b3a05;改動後行號會漂移,以 R-DIAG-09 之掃描為準):

| # | 改動前位置 | 類別 | 內容 | 處置 |
|---|---|---|---|---|
| 1 | `WOrmMdb.mjs:290` | `console.log(err)` | emitChange 之 catch:change 訂閱函數拋出之錯誤(訊息原文) | 改:`diag('change handler threw', { mode, errType[, errCode] }, () => err, true)` |
| 2 | `WOrmMdb.mjs:312` | `console.log(errEmit)` | emitError 之 catch:error 訂閱函數拋出之錯誤 | 改:`diag('error handler threw', …)` |
| 3 | `queryMemory.mjs:27` | sequelize `logging` | initSequelize 之 `logging: opt.logging` | 改:`opt.logging === true && typeof logSql === 'function' ? logSql : false` |
| 4 | `queryMemory.mjs:202` | sequelize `logging` | queryMemory(記憶體過濾表)之 `logging: opt.logging`:CREATE、INSERT(全表各列欄位值)、SELECT(條件值)全文;傳 `true` 時並於 stderr 發 SEQUELIZE0002 | 同上 |
| 5 | `WOrmMdb.mjs:203-205` | 例外訊息 | `throwUrlErr`:`opt.url[${opt.url}]` 回顯完整連線字串(含帳密;未捕獲時 Node 印至 stderr) | 改:`opt.url[${maskUrl(opt.url)}]`(R-DIAG-06) |
| 6 | `WOrmMdb.mjs:216` | 例外訊息 | `dialect[${dialect}] is not mdb`:無 `://` 時 dialect 即整串 opt.url | 改:`dialect[${maskDialect(opt.url)}]`(R-DIAG-06) |
| 7 | 依賴 w-orm-reladb `genModelsByTabs.mjs:36,150,153`(1.1.15;1.1.17 為 `:37,151,154`,簽章 `:106`) | 依賴之 console.log | 固定訊息、`generate file: <路徑>`、`save file catch <err>`(經 `ee.genModelsByTabs`) | 轉傳 `diag` 為第 4 引數(須依賴 ≥ 1.1.17;`package.json` 下限 `^1.1.17`);**不替換全域 `console.log`**(mdb-run02 移除 `withDiagConsole`;R-DIAG-05) |
| 8 | sequelize 6.37.8 `lib/`(`Utils.warn`、`logger.warn`、deprecation 等,約 20 處) | 程式庫之固定警告 | 不含列資料;本套件路徑下僅 `logging:true` 會觸發 SEQUELIZE0002(已不傳 `true`) | 可留(README 註明) |
| 9 | connMDB.exe 子行程 | stdout/stderr | 不寫 console;由 wsemi `execProcess` 以串流接收,不轉印;錯誤文字經 res.json 成為 reject 值與 error 事件(契約) | 可留 |
| 10 | wsemi、lodash-es、json5 | — | 無執行中之 console 呼叫(僅範例註解) | 可留 |

- 已註解之 console:0 處。盤點指令:`rg -n "console\.|process\.(stdout|stderr)|emitWarning|logging" src/`(預期:`getDiag.mjs` 內 console 呼叫 4 處〔`diag` 之 logDetail、僅標籤、標籤加摘要三種輸出與 `(unprintable)` 後備〕、其餘僅 `queryMemory.mjs` 之 2 處 `logging:` 與 `WOrmMdb.mjs` 之 `opt.logging`、`logSql`)。

### R-DIAG-01 預設輸出

預設(未給 `logDetail`、`funLog`)只輸出 `console.log(label, safe)` 或 `console.log(label)`:`label` 為固定標籤,`safe` 為不含資料值、id、使用者識別、後端錯誤原文、路徑之摘要(`mode`〔操作別〕、`errType`〔建構子名稱,須合 `^[A-Za-z][A-Za-z0-9_]{0,39}$`〕、`errCode`〔機器代碼:絕對值至 99999 之整數,或 `E…`、`ERR_…` 字串〕、`stmt`〔SQL 敘述種類白名單〕)。預設路徑不呼叫 `getDetail`(細節不被取得)。`safe` 之值再經 `maskSafe` 防禦性遮罩(值恰等於已知憑證者以 `***`)。

| label | safe | 站點 |
|---|---|---|
| `change handler threw` | `{ mode, errType[, errCode] }` | #1 |
| `error handler threw` | `{ mode, errType[, errCode] }` | #2 |
| `sql`(僅 `opt.logging:true`) | `{ stmt }` | #3、#4 |

### R-DIAG-02 `opt.logDetail`

`true` 時還原舊輸出:#1、#2 為單一 Error 引數(同修改前之 `console.log(err)`,bare);`sql` 為單一字串引數 `Executing (default): <SQL>`(同 sequelize 舊輸出,bare);依賴之 genModelsByTabs(≥1.1.17)經 `diag`:`generate file: <路徑>`(label 加細節〔路徑〕)、`save file catch <遮罩後之 Error 副本>`。細節經 `cpMask`:憑證以 `***` 取代(見 R-DIAG-04 之憑證清單),**連線憑證於任何輸出管道(預設、logDetail、funLog)皆不出現**。

### R-DIAG-03 `opt.funLog` 與選項處理

- `funLog(label, safe, detail)`:給予時診斷輸出只交給它,不寫 console(`logDetail` 同時為 `true` 亦然);`detail` 為 `cpMask` 之遮罩**拷貝**(純物件/類別實例〔不保留原型〕/陣列/Error〔message、stack、cause、自有欄位〕/Date;深度 6、節點 2000 為界;函數、二進位、Map/Set、存取器以標記字串代替;不執行使用端程式),無細節者只收兩個引數。
- 選項處理(與本套件其他選項一致):`logDetail` 須為 `true` 才生效、`funLog` 須為函數才生效,其餘視同未給(不拋);選項於建構開始時依名稱讀一次(`logDetail`、`funLog` 在快照之名稱列表內,故不可列舉與繼承而來者〔`defineProperty`、類別 getter〕亦生效),**getter 拋錯時建構原樣拋出**(與 `logging` 等同,有別於 reladb 之「忽略該選項」:本套件之快照對所有選項一律讀取並傳遞拋錯),其後改動呼叫端之 opt 不影響實例。
- 輸出不得使呼叫端失敗(R-DIAG-07)。

### R-DIAG-04 憑證遮罩與 sequelize 紀錄函數

- **遮罩涵蓋面(`diag` 之三個輸出:label、safe、detail)**:`label` 一律經 `maskText`(通常為 src 之固定標籤,惟依賴〔w-orm-reladb 之 genModelsByTabs〕呼叫本 `diag` 時 label 由依賴給定,故不假設其固定);`safe` 之值與屬性鍵經 `maskSafe`(只讀自有資料屬性,不執行 getter,不可讀者視同無摘要);`detail` 經 `cpMask`(值、屬性鍵〔含陣列上之擴充字串鍵與 Symbol 鍵〕、Symbol 值之描述、包裝物件之原始值、Error 之 `name`〔含取自建構子之類別名稱〕、`message`、`stack`)。
- 憑證清單 `getSecrets(opt.url, username, password)`:連線字串、`username:password`(加密檔之資料庫密碼組成)、密碼、帳號(至少 3 字元才單獨遮罩),各取原樣、URL 編碼、單引號加倍;長者在前;純數字且至少 4 位者其數值型別同值亦遮罩;另有不依賴已知秘密之文字規則:內嵌之 `mdb://` 整段(至空白或引號)換成 `mdb://***`,其他 `scheme://帳密@`(取至最後一個 `@`,帳密不含 `/`、引號、空白)。預設 url `mdb://username:password` 為佔位值,其 `username`、`password` 兩字於細節中亦被遮罩(README 註明)。
- `logSql(sql)`:`diag('sql', { stmt: getSqlStmt(sql) }, () => sql, true)`;`logging` 於 `queryMemory.mjs` 兩處皆為 `opt.logging === true && typeof logSql === 'function' ? logSql : false`(**不得直接傳 `opt.logging`**:傳 `true` 時 sequelize 以 console.log 輸出並發 deprecation 警告)。送往 Jet 之語句(`getCmd.mjs`)本即不經紀錄(jet.mjs 無日誌)。
- `sql` 紀錄含過濾表之全表欄位值(INSERT)與條件值(WHERE),故全文只在 `logging:true` 且 `logDetail`/`funLog` 時取得。

### R-DIAG-05 genModelsByTabs

`ee.genModelsByTabs(fd, tabs, opt)` 轉呼叫 `w-orm-reladb` 之 `genModelsByTabs(fd, tabs, opt, diag)`(`WOrmMdb.mjs` 之 `genModelsByTabs`):第 4 引數為本實例之 `diag`(即 `opt.logDetail`/`opt.funLog` 之承接者),依賴(**須 ≥ 1.1.17**:`genModelsByTabs.mjs:106` 簽章接受 `diag`,`:151`、`:154` 之輸出與 `:37` 之警示皆經 `diag`,不直接 console)。預設只輸出 `generate file: { name, type }`、`save file catch { name, type, errType[, errCode] }`(不含路徑與錯誤文字);`logDetail` 還原路徑與(遮罩後之)Error 副本;`funLog` 收 `(label, safe, detail)` 且不寫 console;憑證遮罩由 `diag` 負責。
- **不替換全域 `console.log`**(mdb-run02,主控裁示:替換全域 console 對同程序其他程式有副作用,且只為相容舊版依賴;`withDiagConsole` 及其 `busy` 計數已移除)。`src/` 任何檔不得對 `console` 賦值或重新定義(R-DIAG-09 ⑤)。
- **依賴下限是唯一防線**:`package.json` 範圍 `w-orm-reladb ^1.1.17`;< 1.1.17 的 `genModelsByTabs` 不認得第 4 引數而直接 `console.log`(實測 1.1.15:預設輸出 `generate file:  <路徑>` 與含路徑之錯誤,logDetail/funLog 皆不生效)。`unit-diaglog`〈依賴w-orm-reladb之genModelsByTabs〉釘住:package.json 下限與已安裝版本皆 ≥ 1.1.17,且依賴確以第 4 引數 `diag` 輸出、不寫 console。降版須同步取消本規則。

### R-DIAG-06 建構函式之錯誤訊息(`throwUrlErr`,5 個呼叫點)

訊息前綴與 `Error` 型態(原型為 `Error.prototype`)不變;回顯之 `opt.url` 經純函數 `maskUrl`(不依賴 diag 或尚未解析之帳密):有 `://` 者一律為 `<scheme>://***`(`://` 之後全部不回顯);無 `://` 或非字串為 `***`;scheme 須為識別字(≤20 字元)否則 `***`(空 scheme 照回)。

**與 w-orm-reladb 之 `maskUrl` 的刻意差異(外審 Argon 探測,2026-10-28 實證)**:reladb 之 `maskUrl` 回顯最後一個 `@` 之後的 `host[:port]`(其連線字串必有主機)。本套件之連線字串為 `mdb://帳號:密碼`(無主機;`WOrmMdb.mjs` 之解析只取第一個 `@` 之前為帳密、其後不被使用),帳號與密碼可含 `@`、`:`,故 `@` 之後可能是密碼之後半:初版沿用 reladb 之規則時,`mdb://:MySecret@Pass123` 回顯為 `mdb://***@Pass123`、`mdb://alice@corp.com:12345` 為 `mdb://***@corp.com:12345`(洩漏密碼後半)。故本套件不回顯 `://` 之後任何內容(舊版 LDG1「反向筆誤殘留回顯」亦隨之消失)。

| # | 前綴 | 觸發 | 案數(`unit-urlerr`) |
|---|---|---|---|
| S1 | `no dialect in opt.url` | 以 `://` 開頭 | 2 |
| S2 | `dialect[X] is not mdb` | scheme 非 mdb;X 經 `maskDialect`:有 `://` 且 scheme 合識別字樣式者照回,否則 `***`(無 `://` 時整串 opt.url 即 dialect) | 9 |
| S3 | `invalid username or password in opt.url` | 帳密段不是兩段(含帳號為電郵含 `@`、`@` 之後夾帶數字或尾標記者) | 7 |
| S4 | `invalid username in opt.url` | `useEncryption` 且帳號為空(含密碼含 `@` 者) | 3 |
| S5 | `invalid password in opt.url` | `useEncryption` 且密碼為空 | 3 |

另 4 案:5 站點皆涵蓋、合格 url 照常建構、孤立代理碼元之 `opt.url` 仍為固定詞彙(R-WF,先於解析)、**以子行程建構且不捕獲**(`test/tools/urlerrWorker.mjs`)時 Node 實際輸出到 stderr 之內容含新訊息、不含任何帳密標記。每案斷言:`instanceof Error` 且原型為 `Error.prototype`、`message` 逐字等於預期、`message` 與 `stack` 皆不含帳密標記。

### R-DIAG-07 輸出不得使呼叫端失敗

`getDetail` 拋錯→`(unprintable)`;`funLog` 拋錯與其回傳之 promise/thenable reject 一律吞下(不成為 unhandledRejection);console 拋錯再試 `console.log(label, '(unprintable)')`,仍拋錯則放棄;`diag` 外層另有 try/catch,任何內部拋錯皆不外洩。`getDiag(optLog)` 一律經 `getOptLog` 規範化(傳入任意物件,未給 `funLog` 者不被當成有 funLog 而靜默)。使用端 `funLog` 內呼叫 `console.log`(常見之轉送寫法)時 `funLog` 每筆輸出只被呼叫一次(無遞迴;`unit-diaglog` 第二輪〈R-DIAG-03 使用端funLog內呼叫console.log〉釘住;原因:本套件不替換全域 `console.log`〔mdb-run01 之 `withDiagConsole` 與其 `busy` 計數已於 mdb-run02 移除〕)。`getBriefErr`、`cpMask` 全程不執行 getter 與使用端程式(Proxy、拋錯之陷阱、`Symbol.toStringTag` getter 皆不使其拋錯)。

### R-DIAG-08 回傳契約不變

各操作之 resolve/reject 內容、事件 payload 與時機以修改前(HEAD)為準:`test/tools/diagGolden.json` 由 HEAD 副本(`git archive HEAD src`)實跑 `test/tools/genDiagGolden.mjs` 產生(情境:`plain`〔無訂閱函數拋錯〕、`plainBad`〔change 與 error 訂閱函數皆拋錯〕、`enc`〔加密檔〕、`encWrong`〔錯誤密碼〕,共用層 `test/tools/diagScenario.mjs`)。Jet 後端錯誤訊息隨系統語系而異,比對時非 `invalid ` 開頭者換為固定字串(`normScenario`)。`unit-diaglog-wo` 對 6 種選項組合(預設、logDetail、funLog、logging、logging+logDetail、logging+funLog)× 2 情境逐一比對。重產 golden 須經授權(預期值即修改前之契約)。

### R-DIAG-09 站點掃描(`unit-diaglog-wo`〈站點掃描〉)

①`src/*.mjs` 除 `getDiag.mjs` 外,去除註解後無 `console.`、`process.stdout/stderr`、`emitWarning`、`warn(`;②`getDiag.mjs` 之 console 呼叫(`console.x(` 形式)1–4 處;⑤`src/` 任何檔皆無對 `console` 之賦值或 `defineProperty/defineProperties/assign/setPrototypeOf/set(console…)`(不替換全域 `console.log`,R-DIAG-05;`unit-diaglog-wo`〈站點掃描〉);③`logging:` 於 `src/` 恰 2 處且皆含 `logSql`、`opt.logging`、`: false`(結構檢查);④行為:`initSequelize` 傳回之 `sequelize.options.logging` 只在 `opt.logging === true` 且給予 `logSql` 時為該函數,其餘(`'true'`、`1`、`undefined`、未給 `logSql`)一律 `false`(絕不為 `true` 或 `console.log`)。

### R-DIAG-10 已知限制(LDG)

| 編號 | 內容 |
|---|---|
| LDG1 | (已解除)初版沿用 reladb 之 `maskUrl`(回顯最後一個 `@` 之後的主機)有「`@` 之後為密碼後半」之洩漏與反向筆誤殘留回顯;改為 `://` 之後一律不回顯(R-DIAG-06)。保留編號以免引用錯位 |
| LDG2 | (已改)mdb-run01 時 w-orm-reladb < 1.1.16 之 `genModelsByTabs` 靠 `withDiagConsole` 暫時替換全域 `console.log`;mdb-run02 移除之,改以依賴下限 `^1.1.17` 為唯一防線(R-DIAG-05):< 1.1.17 的依賴不被涵蓋(其輸出直接 `console.log`,含路徑與錯誤)。保留編號以免引用錯位 |
| LDG3 | sequelize 程式庫自身之固定警告不經 diag(不含列資料);connMDB.exe 之 stderr 由 wsemi 接收不轉印;Jet 後端錯誤文字仍為 reject 值與 error 事件之內容(契約,非診斷輸出) |
| LDG4 | 預設 url `mdb://username:password` 之 `username`、`password` 兩字於細節輸出中被遮罩(與其他憑證同處理);細節中之資料值若恰等於憑證亦被遮罩 |
| LDG5 | `errType` 取自錯誤之建構子名稱(識別字樣式、≤40 字元),`errCode` 取自 `code` 資料屬性之機器代碼樣式(`E[A-Z]{2,15}`、`E2BIG`、`EAI_*`、`ERR_*`、絕對值至 99999 之整數):使用端若以資料值命名類別或以此樣式之值作 `code` 則會出現在摘要(程式識別字,非資料) |
| LDG6 | `cpMask` 對 Proxy 會執行其陷阱(`getPrototypeOf`、`ownKeys`、`getOwnPropertyDescriptor`、陣列之 `length` 讀取;純 JS 無從辨識 Proxy,且 dist 不得使用 `util.types`);只影響使用端自己丟出之 Proxy 錯誤物件,不影響結果。**不執行使用端程式**之其餘保證:getter 不執行、Error 之 `name`/`message` 為存取器或非字串時不讀 `stack`(V8 於首次讀 `stack` 時以之格式化標頭而會執行之;外審 Argon 探測)、包裝物件以原始值處置(不拆成逐字元)、Symbol 值之描述遮罩 |
| LDG7 | 一至兩個字元之密碼會遮罩所有出現處之該字元(含 `safe` 摘要中之 `mode` 等),使輸出難讀(不外洩);數值型密碼少於 4 位時不遮罩同值之數字型別(只遮字串) |
| LDG8 | 非本實例自己之憑證(如錯誤文字內嵌之他處 URL)為盡力遮罩:`mdb://` 整段至空白或引號、其他 `scheme://帳密@主機` 僅帳密不含 `/`、引號、空白者 |

### R-DIAG-11 破壞性變更紀錄(2026-10-28,mdb-run01;相對 1.0.42,版號由發布流程決定;「原行為」取自 HEAD 實跑 `tmp/mdb-run01/probe-head.mjs` 與 HEAD 副本跑 `unit-urlerr`)

見 README〈Breaking changes: diagnostic output〉。要點:①change/error 訂閱函數拋錯之 `console.log(err)` 預設改為 `change handler threw { mode, errType }`(原為整個錯誤);②`logging:true` 預設不再印 SQL 全文(原為含全表欄位值與條件值之全文,並發 SEQUELIZE0002),改為 `sql { stmt }`,全文須 `logDetail:true` 或 `funLog`;③建構函式 `opt.url[…]` 之回顯改為遮罩形式(原為完整 url 含密碼),前綴與 Error 型態不變;`dialect[…] is not mdb` 之 dialect 於無 `://` 時為 `***`;④新增選項 `logDetail`、`funLog`;⑤回傳、事件 payload、時機不變。

### R-DIAG-12 對應測試

| 規則 | 測試 |
|---|---|
| R-DIAG-01~05、07 之純函數 | `test/unit-diaglog.test.mjs`(52 案〔mdb-run02:移除 `withDiagConsole` 4 案、新增依賴契約 3 案與 R-DIAG-07 外層防護 1 案〕:`getOptLog` 型別/getter、`getDiag` 預設/logDetail/funLog/拋錯/promise reject/任意物件選項/外層防護、憑證遮罩〔label、safe 值與鍵、detail〕、`getBriefErr` 白名單〔含 E 夾帶數字樣式〕與不執行使用端程式、`maskText`〔含內嵌 `mdb://`、空字串秘密〕/`getSecrets`、`cpMask`〔原型、Symbol 鍵與值、包裝物件、陣列擴充鍵、cause、數字密碼、getter、Error 之 name/message 存取器不讀 stack、類別名稱、二進位、循環、過深〕、**依賴 w-orm-reladb 之 genModelsByTabs〔版本下限、以第 4 引數 `diag` 輸出且不寫 console、本套件 diag 承接預設/logDetail/funLog〕**、funLog 內 console.log 只被呼叫一次、`getSqlStmt`、`maskUrl`/`maskDialect`〔形態表含 `@` 後為密碼後半者、scheme 邊界、≥1500 組組合掃描〕);不需 Windows |
| R-DIAG-06 | `test/unit-urlerr.test.mjs`(28 案;不需 Windows;`test/tools/urlerrWorker.mjs`) |
| R-DIAG-01~05、08、09(實例,真 Jet) | `test/unit-diaglog-wo.test.mjs`(Windows;42 案:預設、logDetail〔格式還原〕、funLog〔摘要與細節、型別錯誤、拋錯與 reject 被吞、getter、不可列舉/繼承之選項、建構時讀一次、message 存取器不被執行〕、回傳契約 14 案、連線憑證遮罩〔加密檔,帳號 `Zuser9`、密碼 `Zpw7`〕、genModelsByTabs〔預設只有標籤與 `{name,type[,errType,errCode]}`/logDetail/funLog/憑證/funLog 內 console.log/**呼叫期間無任何對 console.log 之賦值**〕、站點掃描〔含 ⑤ 不對 console 賦值〕與 `initSequelize` 行為) |
| 工具 | `test/tools/srcDir.mjs`(`WORM_SRC_DIR` 接縫:令同一份測試對 HEAD 副本或變異副本之 src 執行)、`diagScenario.mjs`、`genDiagGolden.mjs`、`diagGolden.json`、`urlerrWorker.mjs` |

修前紅(對 HEAD 副本以 `WORM_SRC_DIR` 跑):`unit-urlerr` 23 案中 20 紅 3 綠;`unit-diaglog-wo` 35 案中 14 紅(其餘為契約與還原舊輸出之回歸守則,修前即應綠)、2 pending。其後各輪外審修正亦各有修前紅(對修正前之 src 快照跑同一份新測試):第 2 輪 `unit-diaglog`+`unit-urlerr` 64 案中 23 紅;第 3 輪 `unit-diaglog`+`unit-diaglog-wo` 86 案中 7 紅;第 4 輪 `unit-diaglog` 52 案中 3 紅。

變異驗證(2026-10-28 mdb-run01 最終輪,對最終程式碼;工具 `WORM_SRC_DIR` 接縫 + 變異副本,每變異先 `node --check` 排除語法無效):**57 個變異(含 M00 無變異基準),殺死 56、存活 1(M00 基準:證明三個測試檔對副本全綠)、未套用 0、無效 0**;stage1(純函數與建構訊息測試)殺 45、stage2(含真 Jet 之實例測試)殺 11;僅單一測試案殺死者 26 個(M01、M04~M07、M09、M21、M25、M29~M37、M41、M42、M46、M47、M49、M50、M52~M54)。變異涵蓋:`diag` 之三輸出遮罩(label/safe/detail)、預設輸出帶細節、funLog 仍寫 console、`bare`、`funLog` 回傳 promise reject 不吞、`logDetail`/`funLog` 型別檢查、選項快照不依名稱、`maskUrl` 回顯 `@` 後/`://` 後、`maskDialect`、`throwUrlErr` 與 dialect 回顯原值、`emitChange`/`emitError` 直接 `console.log`、sequelize `logging` 直接傳 `opt.logging`(3 種形態)、憑證清單缺項、遮罩拷貝執行 getter/沿用原型/包裝物件/Symbol 值/陣列鍵/類別名/stack 之 name 與 message 檢查、`withDiagConsole`(不包住、不放行 diag 輸出、label 不去尾空白、不還原、`busy` 不遞增/不遞減/不涵蓋 funLog)、`getSqlStmt` 大小寫、`errCode` 樣式、`maskText` 空字串秘密、console 拋錯之兩層防護同時失效(單層失效為等價變異:另一層仍吞下)。**〔mdb-run02 更新〕**原「無從以測試殺死者:`genModelsByTabs` 轉傳第 4 引數 `diag`」一項已解:依賴升至 1.1.17 後轉傳本身可測(變異 M01 不傳 diag、M02 傳靜音 diag、M03 傳忽略選項之 diag 皆被殺);`withDiagConsole` 相關測試與變異面已隨機制移除。各輪原始結果見修正報告證據目錄 `mutation/`。

mdb-run02(2026-10-28,移除 `withDiagConsole`、依賴升 1.1.17)之修前紅與變異:①舊 `src`(`tmp/mdb-run02/src-before`,含 `withDiagConsole`)+ 新依賴 1.1.17,以 `WORM_SRC_DIR` 跑 `unit-diaglog`+`unit-diaglog-wo`:93 案中 2 紅(「呼叫期間無任何對 console.log 之賦值」、站點掃描 ⑤);②新 `src` + 舊依賴 1.1.15(`npm i w-orm-reladb@1.1.15 --no-save` 暫換,實跑後復原):93 案中 8 紅(版本下限、依賴契約 2 案、wo 預設/logDetail/funLog 等,舊依賴三管道皆直接 `console.log` 路徑);③變異 11 個(M01~M09 為 `src` 副本、P01~P02 為獨立 cwd 之 `package.json` 副本)+ 基準 M00:殺死 11、存活 0;初跑 M08(`diag` 外層 catch 改為重新拋出)存活——該防護原只由「內部不可能拋錯」而無從觸及,補 R-DIAG-07 外層防護案(令秘密清單之走訪拋錯)後殺死。工具 `tmp/mdb-run02/mutate.mjs`(已清理),原始結果在修正報告證據目錄。

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
