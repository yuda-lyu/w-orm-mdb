# 規則帳本 — 診斷輸出類

本檔自 `sgud/rule/rulebook.md` 分拆(2026-10-30,mig-mdb2;全域設定 §14:過長即整理)。節號與標題不變,內容原樣搬移,未刪未改;「哪類查哪檔」之索引見 `sgud/rule/rulebook.md`。

## R-DIAG 診斷輸出之單一出口與預設安全(2026-10-28 立;mdb-run01;同日 mdb-run02 移除 `withDiagConsole`〔不替換全域 console〕、依賴下限升至 w-orm-reladb ^1.1.17;來源:第 153 項〔同型之個資輸出〕、w-serv-orm 1.1.20 `getDiag`、w-orm-reladb 1.1.16 `getDiag`/`maskUrl` 及其 reladb-run01/run02 報告;主控定:選項名稱與語意比照 w-serv-orm,各套件自行實作,不抽到 wsemi)

> **2026-10-30 mig-mdb(第 161 項第 3 波)起,本節以 R-DIAG-13 為準**:自寫之 `src/getDiag.mjs` 已刪,出口、遮罩、摘要改用 wsemi 之共用模組(規格:主控 dspec〈診斷輸出與遮罩〉;規則:wsemi `sgud/rule/rulebook_diag.md` R-DIAG-01)。R-DIAG-00～12 之實作細節(`getOptLog`、`getSecrets`、`maskText`、`maskUrl`、`cpMask`、`getBriefErr`、`bare`、label 遮罩、`maskSafe`、整數 errCode、R-DIAG-12 之測試表)保留為歷史紀錄,與 R-DIAG-13 衝突者以 R-DIAG-13 為準;仍有效者:R-DIAG-03 之選項讀取(建構時一次)、R-DIAG-04 之 `logging` 形式、R-DIAG-05 之「不替換全域 console」、R-DIAG-08 之回傳契約(不含憑證之情境)、R-DIAG-09 之站點掃描(改為 src 無任何 console 呼叫)。

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
| S2 | `dialect[X] is not mdb` | scheme 非 mdb;X 經 `maskDialect`(mig-mdb2 起〔LDG10 裁定 B〕):有 `://` 且 `://` 之前不分大小寫等於已知方言名〔`mdb`、`mssql`、`sqlite`、`mysql`、`mariadb`、`postgres`〕者回顯該名之小寫形,其餘(未知方言、看似 scheme 之秘密、無 `://`〔整串 opt.url 即 dialect〕、非字串)一律 `***`;與 `maskDiagUrl` 之 R13 策略一致 | 15 |
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
| R-DIAG-06 | `test/unit-urlerr.test.mjs`(mig-mdb2 起 36 案〔原 28、mig-mdb 起 29〕:S2 擴為 15 案含已知方言名四名與大小寫、`oracle`/`postgresql` 等一律 `***`;看似 scheme 之秘密、已知方言名五名 × 三種大小寫、子行程 stderr;不需 Windows;`test/tools/urlerrWorker.mjs`)、`test/unit-diaglog.test.mjs`〈maskDialect〉6 案(純函數,見 R-DIAG-13〈mig-mdb2〉) |
| R-DIAG-01~05、08、09(實例,真 Jet) | `test/unit-diaglog-wo.test.mjs`(Windows;42 案:預設、logDetail〔格式還原〕、funLog〔摘要與細節、型別錯誤、拋錯與 reject 被吞、getter、不可列舉/繼承之選項、建構時讀一次、message 存取器不被執行〕、回傳契約 14 案、連線憑證遮罩〔加密檔,帳號 `Zuser9`、密碼 `Zpw7`〕、genModelsByTabs〔預設只有標籤與 `{name,type[,errType,errCode]}`/logDetail/funLog/憑證/funLog 內 console.log/**呼叫期間無任何對 console.log 之賦值**〕、站點掃描〔含 ⑤ 不對 console 賦值〕與 `initSequelize` 行為) |
| 工具 | `test/tools/srcDir.mjs`(`WORM_SRC_DIR` 接縫:令同一份測試對 HEAD 副本或變異副本之 src 執行)、`diagScenario.mjs`、`genDiagGolden.mjs`、`diagGolden.json`、`urlerrWorker.mjs` |

修前紅(對 HEAD 副本以 `WORM_SRC_DIR` 跑):`unit-urlerr` 23 案中 20 紅 3 綠;`unit-diaglog-wo` 35 案中 14 紅(其餘為契約與還原舊輸出之回歸守則,修前即應綠)、2 pending。其後各輪外審修正亦各有修前紅(對修正前之 src 快照跑同一份新測試):第 2 輪 `unit-diaglog`+`unit-urlerr` 64 案中 23 紅;第 3 輪 `unit-diaglog`+`unit-diaglog-wo` 86 案中 7 紅;第 4 輪 `unit-diaglog` 52 案中 3 紅。

變異驗證(2026-10-28 mdb-run01 最終輪,對最終程式碼;工具 `WORM_SRC_DIR` 接縫 + 變異副本,每變異先 `node --check` 排除語法無效):**57 個變異(含 M00 無變異基準),殺死 56、存活 1(M00 基準:證明三個測試檔對副本全綠)、未套用 0、無效 0**;stage1(純函數與建構訊息測試)殺 45、stage2(含真 Jet 之實例測試)殺 11;僅單一測試案殺死者 26 個(M01、M04~M07、M09、M21、M25、M29~M37、M41、M42、M46、M47、M49、M50、M52~M54)。變異涵蓋:`diag` 之三輸出遮罩(label/safe/detail)、預設輸出帶細節、funLog 仍寫 console、`bare`、`funLog` 回傳 promise reject 不吞、`logDetail`/`funLog` 型別檢查、選項快照不依名稱、`maskUrl` 回顯 `@` 後/`://` 後、`maskDialect`、`throwUrlErr` 與 dialect 回顯原值、`emitChange`/`emitError` 直接 `console.log`、sequelize `logging` 直接傳 `opt.logging`(3 種形態)、憑證清單缺項、遮罩拷貝執行 getter/沿用原型/包裝物件/Symbol 值/陣列鍵/類別名/stack 之 name 與 message 檢查、`withDiagConsole`(不包住、不放行 diag 輸出、label 不去尾空白、不還原、`busy` 不遞增/不遞減/不涵蓋 funLog)、`getSqlStmt` 大小寫、`errCode` 樣式、`maskText` 空字串秘密、console 拋錯之兩層防護同時失效(單層失效為等價變異:另一層仍吞下)。**〔mdb-run02 更新〕**原「無從以測試殺死者:`genModelsByTabs` 轉傳第 4 引數 `diag`」一項已解:依賴升至 1.1.17 後轉傳本身可測(變異 M01 不傳 diag、M02 傳靜音 diag、M03 傳忽略選項之 diag 皆被殺);`withDiagConsole` 相關測試與變異面已隨機制移除。各輪原始結果見修正報告證據目錄 `mutation/`。

mdb-run02(2026-10-28,移除 `withDiagConsole`、依賴升 1.1.17)之修前紅與變異:①舊 `src`(`tmp/mdb-run02/src-before`,含 `withDiagConsole`)+ 新依賴 1.1.17,以 `WORM_SRC_DIR` 跑 `unit-diaglog`+`unit-diaglog-wo`:93 案中 2 紅(「呼叫期間無任何對 console.log 之賦值」、站點掃描 ⑤);②新 `src` + 舊依賴 1.1.15(`npm i w-orm-reladb@1.1.15 --no-save` 暫換,實跑後復原):93 案中 8 紅(版本下限、依賴契約 2 案、wo 預設/logDetail/funLog 等,舊依賴三管道皆直接 `console.log` 路徑);③變異 11 個(M01~M09 為 `src` 副本、P01~P02 為獨立 cwd 之 `package.json` 副本)+ 基準 M00:殺死 11、存活 0;初跑 M08(`diag` 外層 catch 改為重新拋出)存活——該防護原只由「內部不可能拋錯」而無從觸及,補 R-DIAG-07 外層防護案(令秘密清單之走訪拋錯)後殺死。工具 `tmp/mdb-run02/mutate.mjs`(已清理),原始結果在修正報告證據目錄。

### R-DIAG-13 遷移至 wsemi 之共用模組(2026-10-30,mig-mdb;依主控 dspec〈診斷輸出與遮罩〉D1～D5、Q1～Q4、P1～P9 與 wsemi R-DIAG-01;設計 `diag-run01-設計.md` §4.1、§6.10)

- **單一實作(D1)**:`src/WOrmMdb.mjs` 以 wsemi `getDiag(opt, cfg)` 建本實例之 `diag`;`cfg` 宣告 `secrets: getDiagSecrets({ urls: [opt.url], username, password, paths: [原形式, path.normalize, 絕對] })`、`patterns: ['mdbUrl']`、`safeKeys: SAFE_KEYS`(`['stmt','mode','name','type']`;`name`、`type` 為 w-orm-reladb `genModelsByTabs` 之 diag 參數契約所需)。**未宣告** `codes`/`types`/`nested`:診斷站點之錯誤只有呼叫端之訂閱函數與 genModelsByTabs 之 fs 錯誤(SYS 恆含),Jet 錯誤編號不經診斷出口。`throwUrlErr` 用 `maskDiagUrl(opt.url, { schemes: ['mdb'] })`(dspec Q2)。`getSqlStmt` 移 `src/getSqlStmt.mjs`、`maskDialect` 移 `src/maskDialect.mjs`(本套件專屬,行為不變)。src 無任何 console 呼叫。
- **診斷站點(level 皆省略=stdout)**:`diag('sql', { stmt }, () => sql)`、`diag('change handler threw', { mode, ...diag.brief(err) }, () => err)`、`diag('error handler threw', …)`;`genModelsByTabs` 第 4 引數傳本實例之 `diag`(w-orm-reladb ≥1.1.18 之契約:受方只以固定 label `generate file:`、`save file catch` 呼叫)。label 為字面值,不做文字遮罩。
- **對外錯誤值(D3)**:外來值(Jet 引擎與 connMDB.exe 之錯誤文字、執行檔之取得或執行失敗、sequelize、呼叫端數據之 getter/toString/Proxy 陷阱)→ 整批 reject 與 'error' 事件經 `outErr`(=`diag.err`),逐筆 `err` 於建立時 `getJetErrMsg`/`diag.mask`;快照(`snap`)之拋錯、`initAdodb` 之 close 失敗與 initSequelize 之外來失敗經 `diag.err`。**固定詞彙不包**,以來源登記分流(不依內容):①本套件之 `throw`/`reject` 一律 `ownErr(…)`(**沿用 w-orm-reladb 之 `src/ownErr.mjs`**,與其 `cvFind` 之登記同一 WeakSet);②wsemi `cvOrmFind` 之錯誤恆為固定詞彙,`normFind` 以 `markOwnErr` 登記;③固定字串:`si.err`(匯入失敗訊息 `getImportErr(opt)`,initAdodb 已處置)、`ERR_NOT_ARR`、`ERR_NO_RES`。`new Error(…)` 只留給 Jet 之錯誤文字(外來值)與建構期之同步拋錯。
- **站點全集與處置表**:見 `C:\opensrcOper\dnow\20261029002013\agent-out\mig-mdb-修正報告.md`〈2〉(以 Grep `reject\(|throw |emit\('error'|err: |diag\(|console\.` 列全,無空白格);原始碼盤點由 `test/unit-diaglog.test.mjs`〈原始碼盤點〉鎖定(diag 站點 3 處、`res = outErr(err, si)` 7 處、`let e = outErr(err)` 5 處、逐筆 err 之形式、`new Error` 之用途)。
- **測試**:`unit-diaglog`(純函數與原始碼盤點、固定詞彙之登記、genModelsByTabs 契約;不需 Windows)、`unit-urlerr`(maskDiagUrl 之回顯)、`unit-diaglog-wo`(實例接線:三管道、回傳契約 golden、站點掃描)、`unit-diaglog-wire`(真 Jet:wsemi 共用語料 `_diagCases.mjs` 之 wire 案 17 適用/3 不適用〔附理由〕;七函數與 createStorage 之整批 reject、事件、逐筆 err 之 Jet 錯誤文字〔表名含密碼字樣之控制組/遮罩組〕、快照、預檢、整批流程之 getter、sequelize、close、initSequelize、ensureBins 離線缺檔;固定詞彙〔密碼為 invalid、import〕原樣;paths、mdbUrl、errType/errCode;連線開啟失敗〔del/save 之 openFailed〕、save 寫入階段之逐筆 err)。2026-10-30:4 檔 133 案全綠;修前紅 127 案中紅 60;變異 39 個(漏包 catch 站點 15、逐筆 err 未遮 4、誤包固定詞彙 8、放行/錯置 2、宣告 5、建構期/依賴/串流 5)全數殺死;工具 `tmp/mig-mdb/run-all.mjs`、`mutations.mjs`(已清理,原件在修正報告證據夾)。
- **已知限制(新增)**:**LDG9** 密碼含未編碼之 `@`(`mdb://u:p@ss@tail`)時,本套件以第一個 `@` 前為帳密(Jet 只收 `u:p`),wsemi 以最後一個 `@` 後為主機:整串連線字串與 `mdb://` 之後整段照遮,最後一個 `@` 之後之片段單獨出現時不遮(`unit-diaglog-wire` 記錄行為);**LDG10**(已解,mig-mdb2,主控裁定 B)`dialect[…] is not mdb` 之 dialect 原經 `maskDialect`(識別字樣式照回),看似 scheme 之秘密(語料 R13 型,`myPasswordXYZ://…`)於 dialect 處仍回顯;改為只回顯已知方言名(`mdb`、w-orm-reladb 之 `mssql`、`sqlite`、`mysql`、`mariadb`、`postgres`;不分大小寫、回顯小寫形),其餘一律 `***`(見下〈mig-mdb2〉);**LDG11** reject 清單之密碼少於 4 字元不遮(wsemi 已知限制;診斷細節仍遮);**LDG12** `init()` 回傳之實例物件之 `jet`(內部之 Jet 介面,供 `option.instance` 傳回本套件)若由呼叫端直接呼叫 `query`/`execute`/`run`,其 reject 與結果之錯誤文字為原文(不經七函數之站點;經七函數使用者照遮);LDG3 之「Jet 後端錯誤文字為 reject 值之一部分」改為「只遮憑證」;LDG5、LDG6(errType/errCode 樣式、Proxy 陷阱)改依 wsemi(R-DIAG-01 之已知限制)。
- **〈mig-mdb2〉`maskDialect` 只回顯已知方言名(2026-10-30;主控裁定 1,LDG10 選 B;R-DIAG-06 S2)**:`src/maskDialect.mjs` 之白名單 `DIALECTS = ['mdb','mssql','sqlite','mysql','mariadb','postgres']`(`mdb` 為本套件,其餘五名為 w-orm-reladb `WOrmReladb.mjs` 之 `DIALECTS`);輸入須為字串且含 `://`,`://` 之前轉小寫後(`toLowerCase`)恰等於白名單之一者回顯**白名單之字面值**(故輸出恆為小寫形,不含輸入之任何字元),其餘(未知方言、看似 scheme 之秘密、近似名如 `postgresql`/`mdb2`/`sqlite3`、含空白或換行者、無 `://`〔即使整串恰為方言名〕、非字串)一律 `***`;只看第一個 `://` 之前。與 `maskDiagUrl` 之 R13 策略一致(只保留宣告之名)。**行為變化**(README〈Breaking changes: diagnostic output〉第一與末段):`oracle://…` 由 `dialect[oracle]` 改 `dialect[***]`;`MDB://…` 由 `dialect[MDB]` 改 `dialect[mdb]`;`MSSQL://…` 由 `dialect[MSSQL]` 改 `dialect[mssql]`;`myPasswordXYZ://h` 由 `dialect[myPasswordXYZ]` 改 `dialect[***]`。測試:`unit-diaglog`〈maskDialect〉6 案(白名單逐名、不分大小寫與小寫形、白名單以外一律 `***`、無 `://`/非字串、只看第一個 `://`、組合掃描輸出只可能是白名單名或 `***`)、`unit-urlerr`(S2 15 案、看似 scheme 之秘密、已知方言名五名 × 三種大小寫、子行程 stderr)。結果(2026-10-30,單次 `quiet-run --lock`):受影響 4 檔 144/144;修前紅(修改前之 `maskDialect` + 新測試)`unit-diaglog`+`unit-urlerr` 57 案中紅 15;變異 19 個(白名單漏一名 6、多一名 1、改回樣式比對 1、大小寫 2、無 `://` 1、非字串 1、前綴/子字串比對 2、取最後一個 `://` 1、trim 1、NFKC 1、站點 2)殺死 19、存活 0;全套 `npm test` 3152 passing / 610 pending / 0 failing,exit 0。

