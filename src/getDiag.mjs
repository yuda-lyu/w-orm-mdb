//診斷輸出之單一出口(R-DIAG): src內所有console輸出(含傳給sequelize之SQL紀錄函數、傳給w-orm-reladb之genModelsByTabs之diag)皆經getDiag回傳之diag, 除本檔外不得直接呼叫console
//預設只輸出固定標籤與不含個資之摘要(不含資料值、id、後端錯誤原文、路徑); 連線字串與帳密於任何輸出(含logDetail與funLog之細節)一律以***遮罩
//選項名稱與語意比照w-serv-orm、w-orm-reladb: opt.logDetail(還原細節輸出)、opt.funLog(label, safe, detail)(取代console收完整細節)
//不使用Node內建模組(util等): dist由rollup打包, gDistRollup.mjs之external只列fs、path、module等, 內建模組未列者會被當成未解析之外部相依


//遮罩字串
const MASK = '***'

//cpMask之上限: 深度, 處理的節點與鍵合計數; 超過者以標記字串代替(不交出原參照)
const CP_DEPTH = 6
const CP_MAX = 2000

//錯誤類別名稱的白名單樣式: 只放行建構子名稱(程式識別字), 其餘(可能夾帶資料值之文字)不進預設輸出
const RE_ERR_TYPE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

//錯誤代碼的白名單樣式: 系統慣用之機器代碼(ENOENT、EAI_AGAIN、E2BIG、ERR_xxx; E後只放行大寫字母與底線, 不放行夾帶數字之字串如身分證字號樣式); 整數另行判斷(如Jet錯誤編號3022)
const RE_ERR_CODE = /^(E[A-Z]{2,15}|E2BIG|EAI_[A-Z]{3,10}|ERR_[A-Z0-9_]{1,40})$/

//本套件之連線字串mdb://帳號:密碼(無主機, 帳密可含@/:), 內嵌於文字時整段(至空白或引號為止)不回顯, 不依賴已知秘密
const RE_MDB_URL = /\bmdb:\/\/[^\s'"]*/gi

//其他連線字串內嵌之帳密(scheme://帳密@主機), 不依賴已知秘密亦遮罩; 帳密部分含未編碼之@時取至最後一個@(至空白、/或引號為止)
const RE_URL_CRED = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/'"]*@/g

//Error的stack於V8為自有存取器, 其getter為同一realm內共用的內建函數: 僅當描述子的getter與此相同才讀取(不執行使用端程式)
const STACK_GETTER = (() => {
    try {
        let d = Object.getOwnPropertyDescriptor(new Error(), 'stack')
        return d !== undefined && !Object.prototype.hasOwnProperty.call(d, 'value') && typeof d.get === 'function' ? d.get : null
    }
    catch (e) {
        return null
    }
})()

//陣列索引鍵(canonical數字字串)
const RE_INDEX = /^(0|[1-9][0-9]*)$/

//maskUrl與maskDialect用: scheme須為識別字(含空字串另行放行)
const RE_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]{0,19}$/

//SQL敘述種類白名單(sequelize於記憶體sqlite產生之敘述首字), 其餘一律OTHER
const STMTS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'PRAGMA', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'WITH']


function getOptLog(opt) {
    //診斷輸出的設定, 供WOrmMdb建構時使用, 回傳固定快照{ logDetail, funLog }, 其後各路徑共用此快照, 不再讀取使用端的opt
    //型別錯誤者忽略並用預設(安全輸出), 讀取opt拋錯者亦同, 與本套件其他選項(autoGenPk、useStable、useEncryption等型別錯誤即用預設)一致; 各選項分別讀取, 單一getter拋錯只丟該選項
    //logDetail: 須為true才生效, 預設false; true時console輸出還原為含資料值與錯誤原文的完整細節(連線憑證仍遮罩), 供除錯
    //funLog: 須為函數才生效, 預設無; 給予時診斷輸出只交給它(不寫console), detail為完整細節(連線憑證仍遮罩), 供使用端遮罩或轉送
    //註: WOrmMdb建構時傳入之opt已是依選項名稱讀取一次之快照(資料屬性, getter拋錯者於快照時即原樣拋出, 見R-WF), 下列try只在直接呼叫本函數(任意物件)時防禦
    let logDetail = false
    try {
        logDetail = opt.logDetail === true
    }
    catch (e) {
        //忽略
    }
    let funLog = null
    try {
        let f = opt.funLog
        funLog = typeof f === 'function' ? f : null
    }
    catch (e) {
        //忽略
    }
    return { logDetail, funLog }
}


function getSecrets(url, username, password) {
    //連線憑證清單: 連線字串、帳號、密碼、帳號:密碼(Jet加密檔之資料庫密碼即此組成), 各取原樣、URL編碼與單引號加倍(SQL字串字面值之形式); 長者在前, 使長字串先被遮罩
    //註: 本套件不對opt.url內之百分比編碼解碼, 帳密即其原字串, 故不另列解碼形式
    //註: 帳號單獨出現時至少3字元才遮罩(如sa、u之類過短者會把無關文字一併吞掉); 其與密碼並列之形式(帳號:密碼、連線字串)不受此限
    let isOk = (s) => typeof s === 'string' && s !== ''
    let base = [url]
    if (isOk(username) || isOk(password)) {
        base.push(password, `${username}:${password}`)
        if (isOk(username) && username.length >= 3) {
            base.push(username)
        }
    }
    let all = []
    for (let s of base) {
        if (!isOk(s)) {
            continue
        }
        all.push(s, s.replace(/'/g, '\'\''))
        try {
            all.push(encodeURIComponent(s))
        }
        catch (e) {
            //孤立代理碼元無法編碼, 略過
        }
    }
    return all.filter((s, k) => isOk(s) && all.indexOf(s) === k).sort((a, b) => b.length - a.length)
}


function maskUrl(url) {
    //連線字串之可回顯形式(供建構函式throwUrlErr等解析失敗之訊息使用): 純函數, 不依賴diag或任何尚未建立之物件; 帳號與密碼原文絕不出現
    //  <scheme>://***: 有://時, 其後全部不回顯。本套件之連線字串為mdb://帳號:密碼(無主機), 解析只取第一個@之前為帳密、@之後不被使用,
    //  而帳密可含@與:, 故@之後可能是密碼之後半, 不似其他後端之連線字串可把@之後視為主機而回顯(w-orm-reladb之maskUrl回顯主機, 本套件刻意不回顯)
    //  ***: 無://(整串可能就是帳密或雜訊)或非字串: 整段不回顯
    //  scheme須為識別字(最多20字元), 否則換成***; scheme為空字串(如://…)照回
    if (typeof url !== 'string') {
        return MASK
    }
    let i = url.indexOf('://')
    if (i < 0) {
        return MASK
    }
    let scheme = url.slice(0, i)
    let sc = scheme === '' || RE_SCHEME.test(scheme) ? scheme : MASK
    return `${sc}://${MASK}`
}


function maskDialect(url) {
    //連線字串之dialect(第一個://之前)的可回顯形式(供throwUrlErr之[dialect[…] is not mdb]使用): 純函數
    //無://(整串即dialect而可能就是帳密)或不合scheme樣式者為***, 其餘照回
    if (typeof url !== 'string') {
        return MASK
    }
    let i = url.indexOf('://')
    if (i < 0) {
        return MASK
    }
    let scheme = url.slice(0, i)
    return RE_SCHEME.test(scheme) ? scheme : MASK
}


function getNums(secrets) {
    //秘密中純數字且至少4位者(如數字密碼): 數值型別之同值亦須遮罩; 過短者(如1)遮罩會吞掉大量無關數值, 不納入
    return new Set(secrets.filter((s) => /^[0-9]{4,}$/.test(s)))
}


function maskText(s, secrets = []) {
    //字串中之憑證以***取代: 已知秘密(getSecrets)、mdb://整段、其他scheme://帳密@(帳密含@時取至最後一個@)
    if (typeof s !== 'string') {
        return s
    }
    let r = s
    for (let sec of secrets) {
        //空字串不是秘密(split('')會把每個字元之間都插入遮罩字串)
        if (typeof sec === 'string' && sec !== '' && r.indexOf(sec) >= 0) {
            r = r.split(sec).join(MASK)
        }
    }
    return r.replace(RE_MDB_URL, `mdb://${MASK}`).replace(RE_URL_CRED, `$1${MASK}@`)
}


function maskKey(k, c) {
    //屬性鍵之遮罩: 字串鍵與Symbol之描述文字皆可能含憑證
    if (typeof k === 'string') {
        return maskText(k, c.secrets)
    }
    let d = k.description
    let m = typeof d === 'string' ? maskText(d, c.secrets) : d
    return m === d ? k : Symbol(m)
}


function maskSafe(safe, secrets, nums) {
    //safe摘要之防禦性遮罩: 摘要由src以固定欄位組成(類別名稱、機器代碼、操作別等), 其值若恰等於已知憑證(如數字密碼同時為錯誤代碼)仍以***取代
    if (safe === null || typeof safe !== 'object') {
        return safe
    }
    let r = {}
    for (let k of Object.keys(safe)) {
        let v = ownData(safe, k) //只讀自有資料屬性, 不執行getter(摘要由src組成, 此為防禦)
        r[maskText(k, secrets)] = typeof v === 'string' ? maskText(v, secrets) : ((typeof v === 'number' || typeof v === 'bigint') && nums.has(String(v)) ? MASK : v)
    }
    return r
}


function unbox(v) {
    //包裝物件(new String、new Number、new Boolean、Object(1n)、Object(Symbol()))之原始值: 以內建valueOf取內部槽, 非包裝物件(含Proxy)必拋TypeError而不執行使用端程式; 回傳{ p }, 非包裝物件為null
    for (let f of [String.prototype.valueOf, Number.prototype.valueOf, Boolean.prototype.valueOf, BigInt.prototype.valueOf, Symbol.prototype.valueOf]) {
        try {
            return { p: f.call(v) }
        }
        catch (e) {
            //非該型之包裝物件
        }
    }
    return null
}


function isSafeErrText(v, key) {
    //Error之stack於首次讀取時由V8依name與message格式化標頭: 沿原型鏈第一個name(或message)若為存取器、或其值非字串(其toString會被呼叫), 讀stack即執行使用端程式;
    //僅當整條原型鏈上該屬性為字串資料屬性(或全無)才算安全
    for (let x = v; x !== null; x = Object.getPrototypeOf(x)) {
        let d = Object.getOwnPropertyDescriptor(x, key)
        if (d !== undefined) {
            return Object.prototype.hasOwnProperty.call(d, 'value') && typeof d.value === 'string'
        }
    }
    return true
}


function cp(v, c, depth) {
    //遞迴複製並遮罩, 不執行使用端程式(不呼叫getter、實例方法、建構子), 不交出原參照; 副本原型一律為內建原型(不沿用使用端的原型: 其繼承屬性未遮罩、util.inspect.custom會在格式化時執行)
    //例外: Proxy之陷阱(getPrototypeOf、ownKeys、getOwnPropertyDescriptor、陣列之length讀取)會被執行(純JS無從辨識Proxy, 且dist不得使用Node內建模組; 已知限制LDG6)
    if (typeof v === 'string') {
        return maskText(v, c.secrets)
    }
    if (typeof v === 'number' || typeof v === 'bigint') {
        return c.nums.has(String(v)) ? MASK : v
    }
    if (typeof v === 'symbol') {
        //Symbol之描述文字可能含憑證
        let d = v.description
        let m = typeof d === 'string' ? maskText(d, c.secrets) : d
        return m === d ? v : Symbol(m)
    }
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) {
        return v
    }
    if (typeof v === 'function') {
        return '[Function]'
    }
    if (depth >= CP_DEPTH || c.n >= CP_MAX) {
        return '[Truncated]'
    }
    if (c.seen.has(v)) {
        return c.seen.get(v)
    }
    c.n++
    let u = unbox(v)
    if (u !== null) {
        //包裝物件以其原始值處置(否則會被複製成逐字元之物件, 密碼被拆成單字而不被遮罩)
        return cp(u.p, c, depth)
    }
    try {
        if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) {
            return `[Binary ${v.byteLength} bytes]`
        }
        if (v instanceof Date) {
            return new Date(Date.prototype.getTime.call(v))
        }
        if (v instanceof Map || v instanceof Set || v instanceof WeakMap || v instanceof WeakSet || v instanceof RegExp || v instanceof Promise) {
            return '[Object]' //無法複製的內建物件
        }
        let isArr = Array.isArray(v)
        let isErr = v instanceof Error //不用Object.prototype.toString(會執行Symbol.toStringTag之getter)
        let r = isArr ? new Array(v.length) : (isErr ? new Error() : {})
        c.seen.set(v, r)
        for (let k of Reflect.ownKeys(v)) {
            if (c.n >= CP_MAX) {
                break
            }
            if (k === 'length' && isArr) {
                continue
            }
            let d = Object.getOwnPropertyDescriptor(v, k)
            if (d === undefined) {
                continue
            }
            c.n++
            let val = '[Getter/Setter]'
            if (Object.prototype.hasOwnProperty.call(d, 'value')) {
                val = cp(d.value, c, depth + 1)
            }
            else if (isErr && k === 'stack' && STACK_GETTER !== null && d.get === STACK_GETTER && isSafeErrText(v, 'name') && isSafeErrText(v, 'message')) {
                //stack於V8為內建存取器: 僅當其getter嚴格等於同realm共用之內建getter、且name與message於原型鏈上為字串資料屬性(首次讀取時V8以之格式化標頭)才讀取(不執行使用端程式)
                let s = STACK_GETTER.call(v)
                val = typeof s === 'string' ? maskText(s, c.secrets) : val
            }
            if (isErr && (k === 'message' || k === 'name') && typeof val !== 'string') {
                //Error副本之message與name須為字串: 非字串(物件等)會使console.log之格式化拋錯而只剩(unprintable)
                val = '[Object]'
            }
            //陣列之索引鍵(正整數字串)原樣, 其餘(陣列上之擴充字串鍵與Symbol鍵)亦須遮罩
            Object.defineProperty(r, isArr && typeof k === 'string' && RE_INDEX.test(k) ? k : maskKey(k, c), { value: val, writable: true, enumerable: d.enumerable, configurable: true })
        }
        if (isErr && !Object.prototype.hasOwnProperty.call(r, 'name')) {
            //類別名稱常在原型上(class MyError extends Error): 取原型鏈上第一個資料屬性name, 副本才保有類別名稱
            for (let x = Object.getPrototypeOf(v); x !== null; x = Object.getPrototypeOf(x)) {
                let d = Object.getOwnPropertyDescriptor(x, 'name')
                if (d !== undefined) {
                    if (Object.prototype.hasOwnProperty.call(d, 'value') && typeof d.value === 'string') {
                        Object.defineProperty(r, 'name', { value: maskText(d.value, c.secrets), writable: true, enumerable: false, configurable: true })
                    }
                    break
                }
            }
            //class MyError extends Error {}之類別名稱為建構子之靜態name而不在原型上, 上列只會讀到Error.prototype.name: 副本之name仍為Error時改取建構子名稱(識別字樣式者; 不執行getter)
            let nm = Object.prototype.hasOwnProperty.call(r, 'name') ? r.name : 'Error'
            if (nm === 'Error') {
                for (let x = Object.getPrototypeOf(v); x !== null; x = Object.getPrototypeOf(x)) {
                    let ctor = ownData(x, 'constructor')
                    if (typeof ctor === 'function') {
                        let cname = ownData(ctor, 'name')
                        if (typeof cname === 'string' && cname !== 'Error' && RE_ERR_TYPE.test(cname)) {
                            Object.defineProperty(r, 'name', { value: maskText(cname, c.secrets), writable: true, enumerable: false, configurable: true })
                        }
                        break
                    }
                }
            }
        }
        return r
    }
    catch (e) {
        return '[Uncopyable]'
    }
}


function cpMask(v, secrets = []) {
    //交給console或funLog之完整細節的遮罩拷貝: 憑證以***取代(值、屬性鍵、Symbol描述、同值數字), 不改動呼叫端的原物件(細節若與其後仍要使用的物件共用, 使用端原地遮罩會改變結果)
    //複製: 純物件與類別實例(複製自有屬性成普通物件, 不保留原型)、陣列、原生Error(含message、stack、cause、類別名稱name)、Date; 標記字串代替: 函數、二進位資料、Map與Set等內建物件、存取器、過深或過大者
    return cp(v, { secrets, nums: getNums(secrets), n: 0, seen: new WeakMap() }, 0)
}


function noop() {
    //吞下funLog回傳之promise的reject
}


function swallow(r) {
    //funLog的回傳若為promise或thenable, 附上reject處理, 使其reject不成為unhandledRejection; 全程不使診斷輸出拋錯
    try {
        if (r !== null && (typeof r === 'object' || typeof r === 'function')) {
            let t = r.then
            if (typeof t === 'function') {
                let x = t.call(r, undefined, noop)
                if (x !== null && (typeof x === 'object' || typeof x === 'function') && typeof x.then === 'function') {
                    x.then(undefined, noop)
                }
            }
        }
    }
    catch (e) {
        //放棄
    }
}


function getDiag(optLog, secrets = []) {
    //回傳診斷輸出函數diag(label, safe, getDetail, bare), 所有診斷輸出皆經此(R-DIAG)
    //label: 固定標籤; safe: 不含資料值、id、錯誤原文與路徑的摘要(預設輸出), 無則undefined; getDetail: 回傳完整細節的函數(只在有消費者時才呼叫), 無細節則undefined
    //bare: 為true者, logDetail還原時只輸出細節而不加label(舊版該站即為console.log(細節))
    //輸出不得使呼叫端的流程拋錯: 細節的取得、console與funLog的拋錯一律吞下; funLog回傳的promise之reject亦吞下
    //一律經getOptLog規範化: 未給funLog之物件(如{ logDetail: true })其funLog為undefined, 不得被當成有funLog而吞下全部輸出(傳入getOptLog之回傳值或任意物件皆可)
    let { logDetail, funLog } = getOptLog(optLog)
    let nums = getNums(secrets)
    let emit = (label, safeRaw, getDetail, bare) => {

        //safe, 摘要(防禦性遮罩後); 摘要不可讀(存取器拋錯等)者視同無摘要
        let safe
        try {
            safe = maskSafe(safeRaw, secrets, nums)
        }
        catch (e) {
            safe = undefined
        }

        //getArgs, 完整細節(憑證遮罩後); 僅在需要時取得
        let getArgs = () => {
            if (getDetail === undefined) {
                return []
            }
            try {
                return [cpMask(getDetail(), secrets)]
            }
            catch (e) {
                return ['(unprintable)']
            }
        }

        //funLog, 取代console輸出
        if (funLog !== null) {
            try {
                swallow(funLog(label, safe, ...getArgs()))
            }
            catch (e) {
                //放棄輸出
            }
            return
        }

        //console, 預設為安全摘要; logDetail為true時還原完整細節
        try {
            if (logDetail) {
                console.log(...(bare ? [] : [label]), ...getArgs())
            }
            else if (safe === undefined) {
                console.log(label)
            }
            else {
                console.log(label, safe)
            }
        }
        catch (e) {
            try {
                console.log(label, '(unprintable)')
            }
            catch (e2) {
                //放棄輸出
            }
        }
    }
    return (label, safeRaw, getDetail, bare = false) => {
        try {
            //label通常為src之固定標籤, 惟依賴(如w-orm-reladb之genModelsByTabs)呼叫本diag時其label由依賴給定, 故一律遮罩
            emit(typeof label === 'string' ? maskText(label, secrets) : label, safeRaw, getDetail, bare)
        }
        catch (e) {
            //輸出不得使呼叫端拋錯
        }
    }
}


function ownData(o, k) {
    //取o自有資料屬性k之值, 不執行getter; 非資料屬性或無則undefined
    try {
        if (o === null || (typeof o !== 'object' && typeof o !== 'function')) {
            return undefined
        }
        let d = Object.getOwnPropertyDescriptor(o, k)
        return d !== undefined && Object.prototype.hasOwnProperty.call(d, 'value') ? d.value : undefined
    }
    catch (e) {
        return undefined
    }
}


function isErrCode(c) {
    //錯誤代碼是否為機器代碼: 絕對值至99999之整數(如Jet錯誤編號), 或ENOENT類、ERR_開頭之字串
    if (typeof c === 'number') {
        return Number.isInteger(c) && Math.abs(c) <= 99999
    }
    return typeof c === 'string' && RE_ERR_CODE.test(c)
}


function getBriefErr(e) {
    //錯誤(後端或訂閱函數拋出的值)的摘要: 只列類別與代碼, 不含訊息文字; 全程不執行getter與使用端程式
    //字串(本套件之Jet錯誤常以字串reject)列為string; Error取其建構子名稱(程式識別字, 非資料), 不合識別字樣式者列為Error;
    //代碼取自有資料屬性code, 限機器代碼樣式
    try {
        if (typeof e === 'string') {
            return { errType: 'string' }
        }
        if (e === null || (typeof e !== 'object' && typeof e !== 'function')) {
            return { errType: e === null ? 'null' : typeof e }
        }
        let r = { errType: typeof e === 'function' ? 'function' : 'object' }
        if (e instanceof Error) { //不用Object.prototype.toString(會執行Symbol.toStringTag之getter)
            let cname
            for (let x = e; x !== null && cname === undefined; x = Object.getPrototypeOf(x)) {
                let ctor = ownData(x, 'constructor')
                if (typeof ctor === 'function') {
                    cname = ownData(ctor, 'name')
                    break
                }
            }
            r.errType = typeof cname === 'string' && RE_ERR_TYPE.test(cname) ? cname : 'Error'
        }
        let c = ownData(e, 'code')
        if (isErrCode(c)) {
            r.errCode = c
        }
        return r
    }
    catch (e2) {
        return { errType: 'unknown' }
    }
}


function getSqlStmt(sql) {
    //SQL紀錄的敘述種類(白名單首字, 去除sequelize加上之Executing (連線代號): 前綴), 不含表名與值; 其餘為OTHER
    if (typeof sql !== 'string') {
        return 'OTHER'
    }
    let m = sql.replace(/^\s*Executing \([^)]*\):\s*/i, '').match(/^\s*([A-Za-z]+)/)
    let w = m === null ? '' : m[1].toUpperCase()
    return STMTS.indexOf(w) >= 0 ? w : 'OTHER'
}


export { getOptLog, getSecrets, maskText, maskUrl, maskDialect, cpMask, getDiag, getBriefErr, getSqlStmt }
