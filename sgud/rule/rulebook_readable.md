# 規則帳本 — 讀取即拋錯之輸入(可讀性)

## R-READABLE 讀取即拋錯之輸入依原失敗通道拒絕(2026-11-20 立;第 557 項,w-orm 系列規則二與全族對齊口徑 A1~A6;依據:dspec〈輸入參數之檢測機制〉K2、K3、V19、V20、§11,wsemi 之 `chkReadable`〔R-READABLE-01〕)

**背景**:wsemi 1.9.69 起判斷函數(`iseobj`、`isearr`、`isestr`、`isbol` 等)對「讀取即拋錯」之值(已撤銷之 Proxy、`Symbol.toStringTag` 拋錯者、陷阱拋錯之 Proxy、元素讀取拋錯之陣列)一律回 `false` 而不拋錯,呼叫端無從分辨「型別不符」與「不可讀」:不可讀之 `data` 被當成「輸入無效」而早退,不可讀之建構 `opt` 成員被當成型別不符而取預設值。本規則於判斷為無效之分支內以 wsemi `chkReadable` 分辨,不可讀者走原失敗通道並以固定詞彙拒絕。

### R-READABLE-00 單一規則(全族口徑 A1~A6 之本庫對照)

呼叫端給的**資料容器**(`data`)、**選項**(建構 `opt` 與各方法之 `option`)、`selectByPk` 之 **`pk`**:

- **不可讀**(讀取即拋錯)→ 走**原失敗通道**,訊息為固定詞彙 `invalid <名稱>: must be a readable value`(不含原例外文字與值,**一律本套件之固定詞彙,不轉出呼叫端物件〔存取器、Proxy 陷阱、巢狀值〕拋出之文字**);
- **可讀而型別不符** → 照既有處理(行為不變);
- **探針置於判斷函數(或讀取)已判為無效/已拋錯之後**:有效輸入不多讀(`opt` 成員於建構僅讀一次、`option` 只讀所需成員,有測試);
- **A1 容器本身不可讀**(已撤銷之 Proxy、`ownKeys`/`get`/`Symbol.toStringTag` 陷阱拋錯致讀其成員即拋錯,以 `chkReadable(容器)` 判定)→ `invalid option: …`(建構為 `invalid opt: …`);
- **A2 存取器拋錯**(容器可讀〔`chkReadable` 不呼叫存取器〕而成員為拋錯之 getter、或僅對字串鍵拋錯之 `get` 陷阱)→ `invalid option.<成員名>: …`(`instance`、`returnList`、`autoInsert`)、`invalid opt.<成員名>: …`(建構之 11 個選項名稱:`url`、`db`、`cl`、`fdModels`、`modelType`、`logging`、`pk`、`autoGenPk`、`useStable`、`storage`、`useEncryption`)。建構時讀到**非選項名稱之自訂鍵**之存取器拋錯 → `invalid opt: …`(不回顯鍵名);
- **A2 之例外(第 557 項全族,主控裁;oro557f3)**:`opt.logDetail`、`opt.funLog` 由 wsemi `getDiag` 處置(診斷出口永不失敗,dspec C15),其**存取器或 `get` 陷阱拋錯者視為未給**(用預設:`logDetail` 關、無 `funLog`),**建構成功**、不 throw、不轉出拋出者之文字。本庫於建構時讀取並複製全部選項(第 66 項),此二鍵之讀取各自包 `try`(複製迴圈內,`catch` 令複本值為 `undefined`);兩者各自獨立(一者拋錯不影響另一者生效),其餘選項之拋錯不被遮掉(`logDetail` 與 `url` 同時拋錯 → `invalid opt.url`)。此二鍵之**值**本身不可讀(已撤銷之 Proxy 等)者原樣複製、建構成功,同由 `getDiag` 處置(核實不改);
- **A3 複製階段**(`snap` 之 `cloneDeep` 與 `flatRow` 攤平)讀取呼叫端資料而拋錯者,**不論頂層或巢狀、不論原因**(列之 `id` 與欄位值為已撤銷之 Proxy 或拋錯之存取器、陣列其後之元素、`u8a` 欄、原型為 `null` 之 Date、過深之巢狀)→ `invalid data: must be a readable value`,與頂層不可讀同通道(寫入入口:`error` 事件恰一次、`data` 為 `null` 後 reject,資料庫不變);複製處之 catch 不分辨頂層與巢狀、不分辨原因(故無 `chkReadable` 探針);
- **A3 之補(P4;oro557f3)複製成功而判斷函數判為無效**:`cloneDeep` 不讀原型鏈而成功、其後 `iseobj`/`isearr` 判無效(判斷函數對不可讀者回 `false` 而不拋錯)之 `data`——原型鏈為 `ownKeys`/`getPrototypeOf` 陷阱拋錯之 Proxy 者(`iseobj` 之 `for…in` 拋錯)、複本之 `length` 讀取拋錯之陣列(`isearr`)——於**判無效之分支內**(`snap` 之 `else if`)以 `isDataReadable(d)` 分辨:`chkReadable(d, { elements: 'first' })`,標籤為 `[object Object]` 者另加 `ownKeys`(型別陣列與 Buffer 不加:wsemi 批 10 前 `ownKeys` 對其列舉全部索引),標籤讀取拋錯視為不可讀;**不可讀者**走 `rejectIn(mode, ownUnreadable('data'))`(固定詞彙 `invalid data: must be a readable value`,`error` 事件恰一次、`data` 為 `null`,資料庫不變,同 A3 之通道),**可讀而型別不符者**(`5`、`null`、字串、`{}`、`[]`、Map、Date、型別陣列、`Object.create(null)`)照既有回空結果(`{ n: 0, nInserted: 0, ok: 1 }`/`[]`、無事件)。**探針只在判無效之分支內**,有效輸入不多讀(`unit-readable` U8:原型為「僅於呼叫堆疊含 `chkReadable` 時拋錯」之 Proxy 之有效 `data` 仍寫入);
- **A4** 入口階段(選項與資料之讀取、判定與複製)拒絕之 `error` 事件之 `data` 為 `null`(單一出口 `rejectIn`);其後之整批拒絕(`invalid id`、含孤立代理之字串等)與逐筆失敗之 `data` 不變(攤平後之複本)。
- **A5** `selectByPk` 之不可讀 `pk` → reject `invalid pk: must be a readable value`(`error` 事件恰一次、`data` 為 `null`);讀取次序 `pk` 先於 `option`;可讀而非有效者回 `null`。

### R-READABLE-01 站點與通道(全集)

| 站點(`src/WOrmMdb.mjs`) | 判斷 | 不可讀之處置 | 名稱 |
|---|---|---|---|
| 建構 `opt` 本身(`for…in` 與成員讀取之 `try`) | `typeof` 為物件 | 同步 `throw Error`:`chkReadable(opt, { ownKeys: true })` 非空 → `invalid opt: …`;否則為成員存取器或陷阱拋錯 → `invalid opt.<成員名>: …`(`curName` 為正在讀取之選項名稱;非選項名稱者以 `invalid opt: …`)。**例外**:`logDetail`、`funLog` 之讀取內層另包 `try`,拋錯者複本值為 `undefined`(視為未給),不進此 `catch` | `opt`、`opt.<成員名>`(11 個) |
| 建構 `opt.url/db/cl/fdModels/modelType/pk/storage` | `isestr` 回 false | 同步 `throw`(`chkReadable(v)`) | `opt.<成員名>` |
| 建構 `opt.autoGenPk/useStable/useEncryption` | `isbol` 回 false | 同上 | `opt.<成員名>` |
| `snap`(insert、insertBulk、save、del 之 `data`) | `cloneDeep` 與攤平拋錯(任何原因) | `rejectIn`:`error` 事件恰一次(`data` 為 `null`)後 reject;資料庫不變 | `data` |
| `snap` 之 `else if (!isDataReadable(d))`(P4) | 複製成功而 `iseobj`/`isearr` 判無效後,`isDataReadable(d)` 判為不可讀(`chkReadable(d, { elements: 'first' })`;標籤 `[object Object]` 者另加 `ownKeys`) | 同上(`rejectIn`) | `data` |
| 各方法之 `option`(`getOpt` 包 `get(option, key, def)`;insert 之 `returnList`/`instance`、insertBulk/del/select/delAll/selectByPk 之 `instance`、save 之 `instance`/`autoInsert`) | `get` 拋錯後 `chkReadable(option)` | `rejectIn`;容器不可讀 → `option`;容器可讀而成員拋錯 → `option.<key>` | `option`、`option.<key>` |
| `selectByPk` 之 `pk` | `normPk` 為 `invalid` 後 `chkReadable(pk)` | 同上 | `pk` |

**核實不改**:`select`/`delAll` 之 `find` 之不可讀由 wsemi `cvOrmFind` 處置(`invalid find: an exception was thrown while reading the condition at [find]`,`error` 事件恰一次、`data` 為 `null`;第 560 項另議);`logging`(`=== true` 比較,無判斷函數)之可讀值不拋;`logDetail`、`funLog` 之**值**不可讀(已撤銷之 Proxy 等)者建構成功(由 wsemi `getDiag` 處置),其**存取器拋錯**者亦建構成功、視為未給(見 R-READABLE-00 A2 之例外;oro557f3 起,原為建構同步 throw `invalid opt.logDetail/funLog: …`)。

### R-READABLE-02 與其他 w-orm 套件之差異(有意)與已知限制

1. `opt` 本身之 `Symbol.toStringTag` 拋錯者:建構子不讀標籤(`for…in` 與成員讀取不經標籤),故建構成功(同 w-orm-lmdb 之 `getOptVal`:只在讀取拋錯後才探);`ownKeys`、`get` 陷阱拋錯者與已撤銷之 Proxy 則同步 throw `invalid opt: must be a readable value`。
2. **已知限制(A3 之範圍,第 557 項主控裁:只到複製處為止)**:複製**之後**才讀取之原型上之存取器與繼承之存取器(類別實例之 getter):`flatRow` 攤平時其拋錯延後至該欄位被讀取(主鍵於 `chkWf`、其餘欄位於產生寫入語句時;與 model 無關之 getter 不被讀,不使操作失敗),屬外來錯誤之診斷出口(經 `diag.err`,V20 ⑥ 不保證;`error` 事件之 `data` 為複本,非 `null`),**不轉固定詞彙**。同屬此類:繼承之存取器回傳不可讀值而 `flatRow` 內層之 `cloneDeep({ x: v[k] })` 失敗者,與其拋錯同延後(不擴大)。
3. **〔已解,oro557f3〕** 原型鏈為拋錯之 Proxy(`Object.create(<ownKeys 或 getPrototypeOf 拋錯之 Proxy>)`)之 `data`:`cloneDeep` 不碰原型鏈而成功,`iseobj` 之 `for…in` 拋錯回 `false`,原被視為「無資料」靜默回 `{ n: 0, nInserted: 0, ok: 1 }`/`[]`、無 `error` 事件(舊碼既有);現於 `snap` 之判無效分支以 `isDataReadable(d)` 分辨,不可讀者固定詞彙拒絕(見 R-READABLE-00 A3 之補)。邊界:`getOwnPropertyDescriptor` 陷阱拋錯之原型於 `cloneDeep` 之複製階段即拋(A3,原即合規);`chkReadable` 不呼叫存取器,原型鏈上之 getter 之拋錯屬第 2 項(複製之後,不擴大)。
4. `isUnreadableData`(第一輪之標籤 + `elements:'first'` + `ownKeys` 探針)已於全族對齊輪移除:複製處之 catch 不分辨頂層與巢狀(A3);oro557f3 起,判無效分支內之探針為 `isDataReadable`(同 `isUnreadableData` 之讀取範圍:`elements: 'first'`,標籤 `[object Object]` 者另加 `ownKeys`),但只在判無效之分支內執行(有效輸入不多讀)。
5. `chkReadable` 之 `ownKeys` 選項於型別陣列、Buffer 亦列舉全部索引(wsemi 批 10 前之繞過):本庫於建構 `opt` 之 catch 內與 `isDataReadable` 內使用;後者只對標籤為 `[object Object]` 者加 `ownKeys`(型別陣列、Buffer、Map 等不加),前者之 `opt` 為極少見之型別陣列時才受影響。

### 對應測試

| 規則 | 測試 |
|---|---|
| R-READABLE-00、01(資料容器、option、pk、建構 opt、find) | `test/unit-readable.test.mjs`(U1~U7;A1~A5 逐代號) |
| A2 之建構 `logDetail`/`funLog` 存取器視為未給(例外) | `test/unit-diaglog-wo.test.mjs`(〈opt.logDetail與opt.funLog之存取器拋錯視為未給〉:4 種存取方式 × 2 鍵、兩者同時、各自獨立、值不可讀、其餘選項仍 throw)、`unit-readable`(建構 13 個名稱:11 個 throw、2 個建構成功;同時拋錯時報其他選項) |
| A3 之 `snap` 複製處 | `test/unit-wellformed.test.mjs`(複製拋錯為 rejected promise)、`unit-diaglog-wire.test.mjs`(snap 複製處不轉出外來文字)、`unit-diaglog.test.mjs`(原始碼盤點:固定詞彙之 `rejectIn(…'data')` 恰 2 處) |
| A3 之補(P4)判無效分支內之探針 | `test/unit-readable.test.mjs` U8(原型鏈為 `ownKeys`/`getPrototypeOf` 拋錯之 Proxy、第二層原型、`length` 讀取拋錯之陣列 × 4 入口;`useStable: false`;可讀而型別不符 7 種不變;有效輸入不探〔陷阱僅於呼叫堆疊含 `chkReadable` 時拋錯〕) |

### 變異驗證

見 `sgud/state/state.md`〈2026-11-20 oro557f3〉與報告;各代號(A1、A2、A3、A4、A5)皆有 ≥2 項轉紅之變異。oro557f3 之變異:A2 例外(建構 `logDetail`/`funLog`)Q01~Q05,P4(判無效分支內之探針)Q07~Q14,及落在改動區之既有變異重跑。
