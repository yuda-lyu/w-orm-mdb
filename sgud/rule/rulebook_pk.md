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

