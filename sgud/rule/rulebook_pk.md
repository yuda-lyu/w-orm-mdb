# 規則帳本 — 主鍵類

本檔自 `sgud/rule/rulebook.md` 分拆(2026-10-30,mig-mdb2;全域設定 §14:過長即整理)。節號與標題不變,內容原樣搬移,未刪未改;「哪類查哪檔」之索引見 `sgud/rule/rulebook.md`。

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

~~先拆包裝物件(`new String(x)`、`new Number(x)` 以 `valueOf()`)~~ → **第 557 項起不拆包裝物件**:只收原始值,String 與 Number 包裝物件為 `invalid`(見 R-PKGIVEN)。

| 輸入 | `str` | `int` | `flt` | `other` |
|---|---|---|---|---|
| 非空字串(不計尾端半形空白 ≤255、無 NUL、良構 UTF-16) | ok(原樣) | 標準數字字串(`String(Number(s))===s`)且為整數→ok(數字);否則 mismatch | 標準數字字串→ok(數字);否則 mismatch | ok(原樣) |
| 非空字串 >255 字元(不計尾端半形空白) | cannot | 同上(必 mismatch) | 同上 | cannot(model 未定義主鍵欄時型別為 other,實體欄仍可能為文字) |
| 字串含 NUL 或孤立代理 | cannot | cannot | cannot | cannot |
| 有限數字 | ok(`String(v)`) | 整數→ok;非整數→mismatch | ok | ok |
| `''`、±Infinity、NaN、布林、物件、陣列、Date、BigInt、Symbol、`new String(x)`、`new Number(x)`、null、undefined | invalid | invalid | invalid | invalid |

### R-PK-03 各函數之處置

| 函數 | ok | invalid | mismatch | cannot |
|---|---|---|---|---|
| selectByPk | 以正規化值 `=` 查 | null(不初始化即回) | null | null,不送 Jet |
| insert / insertBulk | 寫正規化值 | **未帶**(`undefined`、`null`、`''`)依 T6:autoGenPk 且主鍵欄為字串類則補值,否則寫入前整批 reject;**給了**者(其餘 invalid 值)一律寫入前整批 reject `invalid id: not a string or finite number at [data[k].id]`,不補值、不隨 autoGenPk 改變(R-PKGIVEN,第 557 項) | 寫入前整批 reject | 寫入前整批 reject |
| save | 寫正規化值 | 未帶依 T6(同上);給了者該筆 ok:0+`invalid id: not a string or finite number at [data[k].id]`(逐筆通道,不補值,不隨 autoGenPk、autoInsert 改變;R-PKGIVEN) | 寫入前整批 reject | autoInsert 開啟:該筆 ok:0+err;關閉:n:0 ok:1;不送 Jet |
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
2. ±Infinity、`new String('')`、`new Number(NaN)`、BigInt 為無效主鍵(依 T6 補值或 reject;select/delAll 不命中)。〔2026-11-20 第 557 項起:**給了**之無效主鍵不再依 T6 補值,一律 reject,見 R-PKGIVEN;只有未帶(`undefined`、`null`、`''`)依 T6。〕
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

## R-PKGIVEN 主鍵「給了而非字串」即拒絕(2026-11-20 立;第 557 項,w-orm 系列規則一;依據:dspec〈輸入參數之檢測機制〉K2、K3、§11,wsemi 1.9.69 起判斷函數只收原始值)

**背景**:修正前,寫入入口(insert、insertBulk、save)之 `procPk` 把「給了而非有效主鍵」(布林、物件、陣列、Date、BigInt、Symbol、NaN、±Infinity、`new String('')` 等,`normPk` 判為 `invalid`)與「未帶」同樣處置:`autoGenPk` 為 true 時靜默**換成自動產生之 UUID 寫入**(呼叫端以為寫入自己給的主鍵,實際存的是另一個鍵);為 false 時才 reject。`new String('a')` 等包裝物件則被拆包後視同 `'a'`(`selectByPk(new String('a'))` 命中列 `a`、`del` 刪到列 `a`)。

### R-PKGIVEN-00 單一規則

1. **未帶主鍵**只有三種:`id` 為 `undefined`、`null`、`''`(含鍵不存在)。`autoGenPk` 為 true 自動產生;為 false 維持既有整批 reject `invalid data[k].id, autoGenPk is false`。
2. **給了而非有效主鍵**(`normPk` 判為 `invalid` 之其餘值:布林、物件、陣列、Date、BigInt、Symbol、NaN、±Infinity、**String 與 Number 包裝物件**)一律拒絕,**不得靜默換成新產生之主鍵寫入,不隨 `autoGenPk`、`autoInsert` 改變**;訊息固定詞彙 `invalid id: not a string or finite number at [data[k].id]`(`k` 為索引、欄名取自 `opt.pk`;不回顯值)。
3. **失敗通道依各入口既有之通道**(與 R-WF 同一通道,先於初始化〔匯入 model〕、不連線):
   - insert、insertBulk:整批 reject,`error` 事件恰一次(`data` 為呼叫當下之複本)、不發 `change`、資料庫不變;同批多筆不合格以索引最小者為準;
   - save:該筆 `ok: 0` 附同訊息之 `err`(逐筆通道,不改為整批 reject),同批其餘筆照常;`autoInsert: false` 亦同;
   - del:該筆 `ok: 0`,訊息維持既有 `invalid data[k].id`(**刪查入口已拒絕者核實不改**;包裝物件原被拆包而可能刪到列,現 `ok: 0`);
   - selectByPk:回 `null`(可讀而非字串者;不可讀者見 R-READABLE);
   - select、delAll:條件由 wsemi `cvOrmFind` 白名單拒收或不命中任何列(既有,核實不改)。
4. 只收**原始值**:`normPk`、`chkPkWf` 不再拆包裝物件(`unwrap` 已移除)。

### R-PKGIVEN-01 與其他 w-orm 套件之有意差異

**有限數字(含 0)為有效主鍵**(共同規則一第 6 點〔型別化後端之例外〕,主控 2026-11-20 裁定維持):字串類主鍵欄存為 `String(v)`、數值類主鍵欄存為數字(R-PK-02)。**訊息**為 `invalid id: not a string or finite number at [data[k].id]`(主控 2026-11-20 裁定;字串主鍵之後端〔lowdb、level、lmdb、mongodb〕為 `not a string`,同為接受有限數字之型別化後端 w-orm-reladb 與本庫為同一句;`not a string` 字面對本庫不精確)。理由:(1) 本套件之 model 可宣告數值類主鍵欄(INTEGER、DOUBLE 等,Access 資料表常見),拒絕數字會使其 `insert({id:5})`、`selectByPk(5)` 全部失效;(2) 字串類欄收有限數字以 `String(v)` 處置為 2026-10-16 已文件化之裁示(Q1,與 w-serv-orm 一致),dspec N3 亦載 w-serv-orm R-ID-02 以有限 number 為主鍵;(3) 未發生「靜默換成新主鍵」:數字依欄型別寫入為其自身之值。其餘(布林、物件、陣列、包裝物件等)與系列一致拒絕。若主控裁定系列一律拒絕數字,改動點為 `chkWf` 之 `normPk(pkv, 'other')` 判定加 `typeof pkv !== 'string'` 並重寫數值欄相關之 `unit-pkvariant`、`unit-find-intpk` 等案(見報告〈需裁示〉)。

### R-PKGIVEN-02 入口 × 輸入(修前/修後)

見報告〈規則三:入口 × 輸入之行為表〉;測試 `test/unit-pkgiven.test.mjs`(S1~S4)逐格斷言。

### 破壞性變更紀錄(2026-11-20)

1. insert、insertBulk、save 收到**給了而非有效主鍵**(布林、物件、陣列、Date、BigInt、Symbol、NaN、±Infinity、String 與 Number 包裝物件):原靜默換成新產生之主鍵寫入(`autoGenPk` 為 true)或 reject `invalid data[k].id, autoGenPk is false`(為 false);現一律拒絕 `invalid id: not a string or finite number at [data[k].id]`(insert、insertBulk 整批 reject;save 該筆 `ok: 0`)。注意 save 於 `autoGenPk: false` 時原為整批 reject(`invalid data[k].id, autoGenPk is false`),現改逐筆 `ok: 0`(與 R-WF 之 save 通道、w-orm-mongodb 之 `api-pk-given` 同,且不隨 `autoGenPk` 改變)。
2. 包裝物件(`new String('a')`、`new Number(5)`)不再拆包:`selectByPk` 回 `null`(原命中)、`del` 該筆 `ok: 0`(原刪除)、寫入拒絕(原寫入拆包後之值)。
3. 未帶主鍵(`undefined`、`null`、`''`、鍵不存在)之處置不變。
4. 訊息字面(全族對齊輪,2026-11-20):`invalid id: not a string at [data[k].id]` → `invalid id: not a string or finite number at [data[k].id]`(本庫接受有限數字;第一輪之訊息只存在於工作樹、尚未發布,故對已發布版〔1.0.74〕而言為同一次不相容變更)。

## R-PKOWN 主鍵只認自有可列舉之資料屬性(2026-11-20 立;第 569 項,w-orm 系列規則一之補強;依據:主控 `rules-569.md`、olw569 報告〈結論〉6;參考實作 w-orm-lowdb `isOwnPk`/`setPk`/`procPk`/`delCore`、w-orm-postgresql `ownPk`)

**背景**:`snap`(呼叫當下複製)內之 `flatRow` 把非純物件之列(類別實例、`Object.create(proto)` 等)攤平為純物件——`for…in` 取自有與繼承之可列舉屬性、並取原型鏈上之存取器,**以 `defineProperty` 定義為自有資料屬性**(R-WF-04 第 2 點,為使檢核與使用之值為同一固定值)。這使繼承而來之主鍵欄在進入各入口之前即成為自有可列舉屬性、被判為**已帶**:寫入含繼承值(`Object.create({ id: 'a9' })` 存為 `a9`)、`save` 有同值列則 UPDATE(覆寫)、`del` 刪除同值列、`insert` 因同值列而靜默跳過、`insertBulk` 因同值列整批重複鍵 reject(修前以真 Jet 實測,見報告)。純物件之列(原型為 `Object.prototype` 或 `null`)不經攤平,但 `get(v, opt.pk)` 沿原型鏈,`Object.prototype` 上被定義 `id` 時同樣誤判。

### R-PKOWN-00 單一規則

1. **列之主鍵欄(`opt.pk`)只認呼叫端自有可列舉之資料屬性**:為**繼承**(原型鏈上,不論值之型別,含有限數字與類別 getter、frozen 原型、`Object.prototype` 上被定義者)或**自有不可列舉**者,視為**未帶**——`autoGenPk` 為 true 補新主鍵(自有可列舉資料屬性)、為 false 照既有之未帶處置(整批 reject `invalid data[k].<pk>, autoGenPk is false`;主鍵欄為非字串類而 `autoGenPk` 為 true 者照既有訊息 `autoGenPk is true but pk column […]`)。有限數字於**自有**時仍為有效主鍵(R-PKGIVEN-01);**繼承**之有限數字亦為未帶。
2. **判定不得多讀有效輸入**:先以既有路徑取值(攤平時每個名稱只讀一次;存取器拋錯者照 R-WF-04 延後為重新拋出之不可列舉存取器,不改判為未帶),值為未帶(`undefined`、`null`、`''`)即短路不查描述子;**只有值為「給了」才查**複製後之複本之主鍵欄是否為自有可列舉(`Object.prototype.propertyIsEnumerable.call(v, k)`,不呼叫 getter)。有效輸入(自有可列舉之主鍵、含自有存取器)之讀取次數與次序同修前。
3. **`del`**:繼承之主鍵視為未給主鍵,該筆 `ok: 0` 附既有之 `invalid data[k].<pk>`,**不刪庫內同值之列**;**`save`**:不以繼承值更新或覆寫同值之列;**`insert`/`insertBulk`**:不因繼承值而跳過、撞鍵或寫入缺主鍵之列。
4. `selectByPk` 收純量,不適用(傳列物件回 `null`;以測試釘住)。
5. **非主鍵欄之繼承欄位與類別 getter**:既有處置不變(照常攤平寫入;不在本項範圍)。
6. 未帶之各情形(含繼承之 `undefined`/`null`/`''`)之結果與修前相同(`autoGenPk` 補值或 reject)。

### R-PKOWN-01 實作位置(單一擁有者:`src/WOrmMdb.mjs`)

- `isNoPk`(未帶之定義,與 `chkWf`、`procPk` 同:`undefined`、`null`、`''`)。
- `flatRow` 之攤平迴圈:取值後,`k === opt.pk` 且 `!isNoPk(x)` 且複本上 `!propertyIsEnumerable(k)` 者,值定為自有可列舉之 `undefined`(**以 `defineProperty` 定義自有資料屬性,不用賦值**:遮蔽原型上之主鍵欄,原型為唯讀〔frozen、`Object.prototype` 上 `writable: false`〕時嚴格模式賦值會拋 `TypeError`)。
- `unownPk(r)`:攤平列(`flatRow` 之結果)或本即為純資料之複本(`proto` 為 `Object.prototype`、`null` 之物件、`Array.prototype` 之陣列,攤平前提早返回者)——主鍵欄**無自有屬性**而經原型鏈讀得「給了」之值(僅 `Object.prototype` 等被改動時)者,同樣以 `defineProperty` 於該複本定義自有可列舉之 `undefined`;已有自有屬性者(含取值拋錯而定義之重新拋出之存取器)**不讀不改**。
- 補值仍由 `procPk` 以賦值為之:此時各列皆為攤平後之純物件、主鍵欄為自有可寫之資料屬性,賦值不會碰到原型(與 w-orm-lowdb 之 `setPk` 不同:該庫之列保留原型,故補值須 `defineProperty`)。
- 作用範圍:`snap` 為 insert、insertBulk、save、del 之唯一入口複製處(`useStable` 兩種模式皆經),四個入口同受規範;逐入口接線以逐入口變異驗證(`D_*`)。

### R-PKOWN-02 入口 × 輸入(修前/修後)

見報告〈修前/修後表〉;測試逐格斷言(`unit-pkown1~3`)。摘要:

| 情形(主鍵欄僅繼承或自有不可列舉) | 修前 | 修後 |
|---|---|---|
| insert/insertBulk/save,庫內無同值列 | 以繼承值寫入(字串欄存 `String(v)`) | autoGenPk 真:補新主鍵寫入;假:整批 reject |
| insert,庫內有同值列 | 靜默跳過(`nInserted: 0`) | 補新主鍵寫入(真)/reject(假),既有列不動 |
| insertBulk,庫內有同值列 | 重複鍵 reject | 同上 |
| save,庫內有同值列 | 覆寫該列(`nModified: 1`) | 補新主鍵寫入(真)/reject(假),既有列不動 |
| del,庫內有同值列 | 刪除該列(`nDeleted: 1`) | 該筆 `ok: 0`(`invalid data[k].<pk>`),不刪 |
| 自有可列舉(含遮蔽繼承、自有存取器) | 以自有值 | 不變 |
| 自有不可列舉且無繼承 | 已視為未帶(複本不帶不可列舉屬性) | 不變 |

### R-PKOWN-03 已知限制與有意差異(LPKOWN)

| # | 內容 |
|---|---|
| LPKOWN1 | **`Object.prototype` 被定義 `id` 時之測試限制**:①整個呼叫期間汙染會令匯入 model(sequelize)即失敗(`can not import model`,與本規則無關之既有限制,修前修後皆然),故汙染形狀之測試以污染前即初始化之 `option.instance` 呼叫(`unit-pkown-setup.mjs` 之 `getOpt`);②**唯讀之汙染**(`writable: false`)只能在**呼叫之同步段**測試(複製、攤平與遮蔽皆於 `snap` 同步完成):Node 內部會對新物件賦值 `id`(如計時器),持續唯讀之汙染會令行程崩潰;故只在呼叫同步段定義、隨即還原(`unit-pkown3` 之〈遮蔽以defineProperty…〉) |
| LPKOWN2 | 單一物件輸入而鍵全在原型上(`insert(Object.create({ id: 'a9' }))`,無自有鍵)為 wsemi `iseobj` 判無效之早退(`n: 0`,既有,與主鍵無關),不在本規則範圍 |
| LPKOWN3 | 與 w-orm-lowdb 之差異:本庫於攤平處判定(複製後之複本),而非於 `procPk`/`delCore`;有限數字於自有時仍有效(R-PKGIVEN-01),繼承者與其他型別同為未帶 |
| LPKOWN4 | 取值拋錯之繼承存取器(`get id() { throw … }`)仍照 R-WF-04/R-READABLE-02 延後至該欄被讀取時原樣拋出(經診斷出口 `diag.err`),不因此改判為未帶而成功寫入:規則第 2 點「先以既有路徑取值」優先於第 1 點「繼承視為未帶」(兩者於此交會,取前者;與 w-orm-lowdb 之 `procPk` 先取值同序)。insert/insertBulk/save/del 皆整批 reject(`del` 亦非逐筆 `ok: 0`),`error` 事件恰一次;`unit-pkown3` 之 P2 案釘住 |
| LPKOWN5 | **自有性依 `cloneDeep` 之複本判定(與參考實作 w-orm-lowdb 之 `isOwnPk` 同,該庫亦於複本上判定),複本與呼叫端原物件不一致之極端形狀**(複製行為為修前即有,本規則不改;以探針於修前、修後各實測一次):①原型鏈上有唯讀(frozen、`Object.prototype` 上 `writable: false`)或只有 getter 之 `id`,而呼叫端列另有自有可列舉 `id`(`Object.defineProperty(Object.create(Object.freeze({ id: 'a9' })), 'id', { value: 'own1', enumerable: true })`):`cloneDeep` 以賦值複製自有屬性,賦值於嚴格模式拋 `TypeError`,`snap` 轉 `invalid data: must be a readable value`(整批拒收,非靜默;**修前修後相同**);②呼叫端列有自有可列舉之資料屬性 `id`(`Object.defineProperty(instance, 'id', { value: 'own2', enumerable: true })`),而其類別之原型有 `id` 存取器**且帶 setter**:複製時賦值落入原型之 setter,複本無自有 `id`,本規則判為未帶、`autoGenPk` 為真時補新主鍵(修前寫入 `own2`;**此為本規則造成之行為差異**,屬極端形狀);③類別以 `get id()`/`set id(v)` 存取器對承載主鍵(`this.id = x` 經 setter 落在私有欄位,實例上無自有 `id`)者,依規則明示之「類別 getter」為未帶,補新主鍵(修前以存取器之值為主鍵);④ Map、Set、Date 之子類別其建構子於複本上執行,若建構子建立自有可列舉 `id`(預設主鍵),複本之 `id` 即為自有而非呼叫端所給,照用(**修前修後相同**);⑤ lodash 不可複製之標籤(自有不可寫之 `Symbol.toStringTag` 等)之列,於陣列內按參照返回(複本即原物件),此時於純物件分支之 `unownPk` 會直接於呼叫端原物件定義遮蔽屬性(僅在 `Object.prototype` 被定義主鍵欄、該列無自有主鍵時發生;列被凍結則 `defineProperty` 拋錯、轉 `invalid data: must be a readable value`;推演,未實測)。以上皆需二種以上之極端條件並存(③ 為規則明示),實作以複本為準(與 R-WF-04 之快照同一份),未另讀呼叫端原物件之描述子(那會對有效輸入多一次讀取,且與參考實作不同) |
| LPKOWN6 | `Object.prototype` 被定義為**會拋錯之 getter 之 `id`**:`unownPk` 於無自有主鍵之純物件列讀 `r[opt.pk]` 而拋錯,於 `snap` 內轉 `invalid data: must be a readable value`(修前於 `chkWf` 讀到時才拋、走診斷出口 `diag.err`);失敗通道與訊息因此改變,仍為整批 reject、資料庫不變 |

### 破壞性變更紀錄(2026-11-20,第 569 項)

1. 列之主鍵欄僅為繼承(含有限數字、類別 getter、frozen 原型、`Object.prototype` 被定義者)或自有不可列舉者,原被當作已帶之主鍵(寫入、更新、跳過、刪除同值之列),現視為未帶:autoGenPk 真補新主鍵、假整批 reject;`del` 該筆 `ok: 0`。
2. 自有可列舉之主鍵(含遮蔽繼承者、自有存取器)、非主鍵欄之繼承欄位與類別 getter、`selectByPk`:不變。

### 對應測試(R-PKOWN)

| 規則 | 測試 |
|---|---|
| R-PKOWN-00 第 1、3 點(字串主鍵表 × autoGenPk 真) | `test/unit-pkown1.test.mjs`(9 形狀 × 入口 × 有無同值列) |
| R-PKOWN-00 第 1、3 點(autoGenPk 假;整數主鍵表 ipk 兩值) | `test/unit-pkown2.test.mjs` |
| 其餘形狀、第 2 點(讀取次數、拋錯)、同批逐筆、第 4 點(selectByPk)、第 5 點(非主鍵欄)、`opt.pk` 非 id、原物件不被改動、事件、`defineProperty` 非賦值 | `test/unit-pkown3.test.mjs` |
| 共用層(形狀、入口、應然、觀察) | `test/unit-pkown-setup.mjs`(不含測試案例);環境變數 `PKOWN_TRACE=<檔>` 逐格附記觀察供產修前/修後表 |

