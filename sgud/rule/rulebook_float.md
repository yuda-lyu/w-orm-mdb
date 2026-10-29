# 規則帳本 — 日期條件類

本檔自 `sgud/rule/rulebook.md` 分拆(2026-10-30,mig-mdb2;全域設定 §14:過長即整理)。節號與標題不變,內容原樣搬移,未刪未改;「哪類查哪檔」之索引見 `sgud/rule/rulebook.md`。

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

