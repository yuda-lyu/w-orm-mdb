import get from 'lodash-es/get.js'
import chkOrmStr from 'wsemi/src/chkOrmStr.mjs'
import { ownErr } from 'w-orm-reladb/src/ownErr.mjs'


//主鍵之型別判定、正規化與等值判定之輔助
//
//本模組為[何謂字串型別/有效主鍵/主鍵等值]之唯一擁有者, 其他模組不得另寫同類判定(見CLAUDE_rulebook.md之R-PK)。
//主鍵等值一律以Jet唯一索引之判定為準, 本模組只負責:
//  1. normPk: 依主鍵欄型別正規化主鍵值, 並判定無效、型別不符與不可能存在
//  2. kFast: 快速對應鍵, 只會少判不會多判, 對不上者另以Jet之=查詢判定(insert撞鍵核對與select/delAll之主鍵條件共用)
//  3. castPkFind: 把查詢條件(normFind回傳之複本)內之主鍵等值類條件改寫為[命中列之序號集合], 序號集合由呼叫端以Jet判定後提供;
//     主鍵以外之條件原樣保留, 交w-orm-reladb之cvFind轉譯(見CLAUDE_rulebook.md之R-FIND)
//
//Jet 4.0之字串等值(已實測): 不分大小寫(含非ASCII)、忽略尾端半形空白、忽略全半形寬度與平片假名、ß視同ss、ς視同σ, 且忽略增補平面字元;
//WHERE不轉型(文字欄以數字比對、數值欄以字串比對皆回報型別不符), INSERT則自動轉型。
//任何以JS仿製之等值鍵皆為近似: 多判使select/delAll命中Jet視為相異之列, 少判則使$ne/$nin把Jet視為同鍵之列當成相異而刪除,
//兩方向於否定條件下皆會誤刪, 故select/delAll之主鍵等值不以近似鍵判定, 而以Jet之=查詢取得命中列(見WOrmMdb.mjs之resolvePkIdx)。


//字串類、整數類、浮點類之model型別(sequelize之type.key), procPk之補值型別檢查與queryMemory之CITEXT改寫共用
//註: sequelize之DataTypes.DOUBLE之key為'DOUBLE PRECISION'(已實查sequelize 6.37.8), 非'DOUBLE'
const TPS_STR = ['STRING', 'TEXT', 'CHAR', 'UUID', 'CITEXT']
const TPS_INT = ['INTEGER', 'BIGINT', 'SMALLINT', 'MEDIUMINT', 'TINYINT']
const TPS_FLT = ['FLOAT', 'DOUBLE PRECISION', 'DOUBLE', 'REAL', 'DECIMAL', 'NUMBER']


//Jet文字欄之長度上限(不計尾端半形空白), 超過者不可能存在於資料表;
//且Jet對超過此長度之字面值於SELECT與DELETE會截斷後比對(UPDATE不截), 送出將命中或刪除以其前255字元為鍵之另一列
const LEN_TEXT_MAX = 255


//記憶體過濾表之原列序號欄名稱前綴, 實際名稱由genInnerKeys附加亂數產生, 以免與使用者之欄位或條件同名
const KEY_WI = '__worm_wi'


//主鍵欄之範圍運算子, 以正規化值留於原欄比對
const OPS_RANGE = ['$gt', '$gte', '$lt', '$lte']


/**
 * 取主鍵欄型別類別
 *
 * @param {Object} attrs 輸入model之rawAttributes
 * @param {String} pk 輸入主鍵欄位名
 * @returns {String} 回傳'str'、'int'、'flt'或'other'
 */
function getPkType(attrs, pk) {
    let k = get(attrs, `${pk}.type.key`, '')
    if (TPS_STR.indexOf(k) >= 0) {
        return 'str'
    }
    if (TPS_INT.indexOf(k) >= 0) {
        return 'int'
    }
    if (TPS_FLT.indexOf(k) >= 0) {
        return 'flt'
    }
    return 'other'
}


/**
 * 拆包裝物件
 *
 * 註: new String(x)與new Number(x)依toString標籤會被判為字串或數字, 但其值不參與===比較(如new String('')!==''),
 * 故先取出原始值, 令其與原始值同處置
 * 註: 以內建之String.prototype.valueOf/Number.prototype.valueOf讀包裝物件之內部值, 不呼叫物件自身之valueOf:
 * 後者可被呼叫端覆寫(每次讀值結果不同), 且僅偽造toStringTag之一般物件並非包裝物件(內建valueOf對其拋錯, 原樣返回而屬無效值)
 *
 * @ignore
 */
function unwrap(v) {
    if (v !== null && typeof v === 'object') {
        try {
            return String.prototype.valueOf.call(v)
        }
        catch (err) {}
        try {
            return Number.prototype.valueOf.call(v)
        }
        catch (err) {}
    }
    return v
}


/**
 * 主鍵值若為字串, 回傳其不良構之原因(含NUL: SQL文字於NUL被截斷; 含孤立代理: 經exe之UTF-8轉換被換為U+FFFD而改鍵), 合格或非字串回傳null
 *
 * 註: 判定單一擁有者為wsemi之chkOrmStr(第66項, 見CLAUDE_rulebook.md之R-WF), 預設一併檢NUL(主鍵與find同標準); 先拆包裝物件, 與normPk一致
 * 註: 回傳原因為固定詞彙(不回顯值), 供呼叫端組成invalid id: 原因 at [data[索引].主鍵欄]
 *
 * @param {*} v 輸入主鍵值
 * @returns {String|null} 回傳原因字串或null
 */
function chkPkWf(v) {
    v = unwrap(v)
    if (typeof v !== 'string') {
        return null
    }
    return chkOrmStr(v)
}


/**
 * 字串是否超過Jet文字欄上限, 尾端半形空白不計(Jet比對時忽略之, 寫入時亦可容納於上限內)
 *
 * @ignore
 */
function isOverLen(s) {
    return s.replace(/ +$/, '').length > LEN_TEXT_MAX
}


/**
 * 依主鍵欄型別正規化主鍵值
 *
 * 註: kind為'ok'(v為正規化後之值)、'invalid'(未給或非有效值, 依T6處置)、'mismatch'(與主鍵欄型別不符)、'cannot'(不可能存在於資料表)
 * 註: 字串類主鍵欄之有限數字以String(v)處置, 與w-serv-orm一致; 數值類主鍵欄僅轉換標準數字字串(String(Number(s))===s),
 * 其餘字串因Jet之INSERT轉型會改變鍵(如'012'存為12)而視為型別不符; 整數類主鍵欄之非整數因Jet會四捨六入五成雙而視為型別不符
 * 註: ±Infinity、NaN、空字串、布林、物件、陣列、Date、BigInt、null、undefined為無效
 * 註: 超過255字元(不計尾端半形空白)之字串於字串類與其他型別(含model未定義主鍵欄而無從得知型別者)皆為不可能存在
 * 註: 含NUL或孤立代理之字串(不良構, chkPkWf)亦為不可能存在, 且kind為'cannot'時附why(固定原因詞彙); 其kind不用'invalid',
 * 以免autoGenPk為true時被當成[未給主鍵]而以自動產生之UUID取代(寫入成功卻非呼叫端所給之主鍵), 呼叫端須以why區辨良構性與長度上限(後者無why)
 *
 * @param {*} v 輸入主鍵值
 * @param {String} tp 輸入主鍵欄型別類別, 取自getPkType
 * @returns {Object} 回傳{kind,v}, kind為'cannot'時可能附why
 */
function normPk(v, tp) {

    //unwrap
    v = unwrap(v)

    //string
    if (typeof v === 'string') {
        if (v === '') {
            return { kind: 'invalid' }
        }
        let why = chkOrmStr(v)
        if (why !== null) {
            return { kind: 'cannot', why }
        }
        if (tp === 'int' || tp === 'flt') {
            let n = Number(v)
            if (!Number.isFinite(n) || String(n) !== v) {
                return { kind: 'mismatch' }
            }
            if (tp === 'int' && !Number.isInteger(n)) {
                return { kind: 'mismatch' }
            }
            return { kind: 'ok', v: n }
        }
        if (isOverLen(v)) {
            return { kind: 'cannot' }
        }
        return { kind: 'ok', v }
    }

    //number
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) {
            return { kind: 'invalid' }
        }
        if (tp === 'str') {
            return { kind: 'ok', v: String(v) }
        }
        if (tp === 'int' && !Number.isInteger(v)) {
            return { kind: 'mismatch' }
        }
        return { kind: 'ok', v }
    }

    return { kind: 'invalid' }
}


/**
 * 快速對應鍵: 去尾端半形空白並僅將ASCII字母轉小寫
 *
 * 註: 此二者Jet必視為相等(已實測), 故快速鍵相同者必為同一主鍵, 只會少判不會多判;
 * 寬度、假名、非ASCII大小寫等之對應不在此判定, 對不上者另以Jet之=查詢判定
 *
 * @param {String|Number} v 輸入主鍵值
 * @returns {String} 回傳快速鍵字串
 */
function kFast(v) {
    return String(v).replace(/ +$/, '').replace(/[A-Z]/g, (c) => {
        return c.toLowerCase()
    })
}


/**
 * 產生記憶體過濾表之原列序號欄名稱, 附加亂數令其不與使用者之欄位或條件同名
 *
 * @param {Object} attrs 輸入model之rawAttributes
 * @returns {Object} 回傳{wi}
 */
function genInnerKeys(attrs) {
    for (let i = 0; i < 100; i++) {
        let wi = `${KEY_WI}_${Math.random().toString(36).slice(2, 10)}`
        if (get(attrs, wi) === undefined) {
            return { wi }
        }
    }
    throw ownErr('can not generate inner keys for memory filter')
}


/**
 * 是否為一般物件: 原型為Object.prototype或null
 *
 * 註: 查詢條件之判定與走訪不得用wsemi之isobj與lodash之each/keys: 具數值length之物件會被當成陣列樣迭代,
 * Symbol鍵與不可列舉之鍵會被丟棄, 條件因而變成{}而使delAll刪光全表(見CLAUDE_rulebook.md之R-FIND-02)
 *
 * @param {*} v 輸入任意值
 * @returns {Boolean} 回傳是否為一般物件
 */
function isPlainObj(v) {
    if (v === null || typeof v !== 'object') {
        return false
    }
    let p = Object.getPrototypeOf(v)
    return p === Object.prototype || p === null
}


/**
 * 設定自有屬性, 以defineProperty建構, 令鍵為__proto__時亦為自有鍵而不改原型(交cvFind拒收)
 *
 * @ignore
 */
function putProp(o, k, v) {
    Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true })
}


/**
 * 物件是否為運算子物件(一般物件且含任一$開頭之鍵或Symbol鍵); 否則視為一般值(如{}), 屬無效主鍵值
 *
 * @ignore
 */
function isOpObj(c) {
    if (!isPlainObj(c)) {
        return false
    }
    return Reflect.ownKeys(c).some((k) => {
        return typeof k === 'symbol' || k[0] === '$'
    })
}


/**
 * 改寫查詢條件內之主鍵條件
 *
 * 註: 輸入為WOrmMdb.mjs之normFind(wsemi之cvOrmFind)回傳之複本, 已在系列條件白名單內(見CLAUDE_rulebook.md之R-WL): 欄位等值、$eq $ne $gt $gte $lt $lte $in $nin、文件層$and $or,
 * 純量為字串、有限數字、布林、Date、null; 本函數在複本上單趟走訪, 每個值只讀一次
 * 註: 主鍵等值類條件(隱含等值、$eq、$ne、$in、$nin)改寫為原列序號欄wi之$in/$nin,
 * 序號集合以佔位陣列置於條件內並列於回傳之slots(各含正規化後之主鍵值vals與佔位陣列is), 呼叫端以Jet判定命中列後以fillPkSlots就地填入,
 * 故命中判定與selectByPk、del等一致, 不經任何近似鍵
 * 註: 主鍵欄只認鍵與pk完全相符者(與reladb之cvFind之嚴格鍵一致), 大小寫或尾端空白不同之近似鍵原樣交cvFind拒收
 * 註: 範圍運算子($gt、$gte、$lt、$lte)留於原欄依記憶體sqlite比較(近似): 界限為有效主鍵值(ok)時以正規化值比較, 其餘(無效、型別不符、不可能存在)原樣留於原欄交cvFind依欄型比較或拒收
 * (整數主鍵之k > 2.5應命中3、4、5, id < 300個z應為全部; cvFind欄型檢核不接受者如整數主鍵給'abc'、布林、Date則reject), 不改寫為恆假(LW6);
 * 其餘運算子正常不可能到達(cvOrmFind已拒), 若到達則原樣留於原欄, 由cvFind再拒
 * 註: 等值類肯定語境($eq、$in、隱含等值)之無效、型別不符、不可能存在之值不命中(對等值而言不可能等於主鍵欄之值即不命中, 本就正確, 不留null給cvFind);
 * 否定語境($ne、$nin)之無效或型別不符之值(如布林、Date、空字串)一律拋出:
 * 依[無效值不命中]推得之否定為[全部命中], 用於delAll即清空全表, 而此類值多為呼叫端之錯誤;
 * 不可能存在之值於否定語境依其語意為必不相等
 * 註: $ne:null不是無效值而是[非NULL]: 原樣留於原欄交cvFind轉為IS NOT NULL(與非主鍵欄、reladb相同, 令dspec之可攜寫法於主鍵欄亦可用; LW2);
 * 呼叫端若以變數為值, 變數為null時delAll({pk:{$ne:變數}})即刪除全部非NULL主鍵之列(JSDoc已載); {pk:null}、$eq:null維持肯定語境無效值不命中
 * 註: 非運算子物件(如{})視為主鍵值而非條件, 屬無效值, 不得因其無運算子而使主鍵條件消失(cvOrmFind已拒空運算子物件, 此為單獨呼叫本函數時之防線)
 * 註: 主鍵所衍生之序號條件併入同一物件(欄位wi之運算子物件{$in,$nin}), 不增巢狀層(增層會把合法深度放大而於其後cvFind內之再檢核被拒); 同運算子重複者才另以字串鍵{$and:[其餘, ...]}置放;
 * 邏輯陣列之元素若其主鍵條件皆化簡掉(如$ne僅含不可能存在之值)則以恆真之序號條件{wi:{$nin:[-1]}}代替空物件(白名單拒空條件); 不得用sequelize之Symbol Op(cvOrmFind拒Symbol鍵, reladb 1.1.10之cvFind對其reject)
 * 註: 序號條件不產生sequelize之literal(空集合以不存在之序號-1表示)
 * 註: 走訪以Reflect.ownKeys並以defineProperty建構, 不用lodash之each: 具數值length之物件會被當成陣列樣迭代而使條件消失;
 * 非一般物件原樣返回(不可能到達, 交cvFind拒收); 主鍵以外之欄位、運算子與值原樣保留交cvFind檢核與轉譯
 * 註: 第33項批2已移除: $not(欄位層與文件層)與其整體取反、$nor、$regex、$options、Symbol Op、陣列值即$in、RegExp值、頂層$not保留功能
 *
 * @param {Object} find 輸入條件, normFind回傳之複本
 * @param {String} pk 輸入主鍵欄位名, 給null則不辨識主鍵條件(model無此屬性時, 令主鍵名之鍵交cvFind以嚴格鍵拒收)
 * @param {String} tp 輸入主鍵欄型別類別
 * @param {String} wi 輸入原列序號欄名稱, 取自genInnerKeys
 * @returns {Object} 回傳{find:改寫後之條件, slots:[{vals:正規化後之主鍵值陣列, is:序號佔位陣列}]}
 */
function castPkFind(find, pk, tp, wi) {

    //slots, 序號集合之佔位
    let slots = []

    //err, 否定語境之無效值: 同cvOrmFind之錯誤格式invalid find: 原因 at [路徑], 不回顯值; 固定詞彙, 經ownErr登記令整批reject原樣交出(R-DIAG)
    function err(path) {
        return ownErr(`invalid find: invalid primary key value in negative condition at [${path}]`)
    }

    //normVals, 多值之正規化(純量視為單元素陣列); 肯定語境之無效、型別不符與不可能存在者略過(不命中); 否定語境之無效或型別不符拋出(path為錯誤訊息之路徑)
    function normVals(vs, neg, path) {
        if (!Array.isArray(vs)) {
            vs = [vs]
        }
        let r = []
        for (let k = 0; k < vs.length; k++) { //逐索引, 陣列之洞即undefined(無效值)
            let n = normPk(vs[k], tp)
            if (n.kind === 'ok') {
                r.push(n.v)
            }
            else if (neg && (n.kind === 'invalid' || n.kind === 'mismatch')) {
                throw err(path)
            }
        }
        return r
    }

    //slot, 序號佔位陣列, 由fillPkSlots就地填入
    function slot(vals) {
        let s = { vals, is: [] }
        slots.push(s)
        return s.is
    }

    //cIn, cNin, 序號條件; 無有效值之$in以不存在之序號表示必不命中, 無有效值之$nin為恆成立而不加條件
    function cIn(vals) {
        return { [wi]: { $in: vals.length > 0 ? slot(vals) : [-1] } }
    }
    function cNin(vals) {
        if (vals.length === 0) {
            return null
        }
        return { [wi]: { $nin: slot(vals) } }
    }

    //rangeVal, 範圍運算子之值: ok回正規化值; 其餘(無效、型別不符與不可能存在)原樣回傳, 留於原欄交cvFind依欄型比較或拒收
    //註: 對範圍而言不可能存在之界限仍有明確語意(整數主鍵之k > 2.5應命中3、4、5; id < 300個z應為全部), 改寫為恆假會靜默回錯誤結果(LW6)
    function rangeVal(v) {
        let r = normPk(v, tp)
        return r.kind === 'ok' ? r.v : v
    }

    //push
    function push(conds, c) {
        if (c) {
            conds.push(c)
        }
    }

    //castCond, 主鍵欄之條件, 回傳{conds:[序號條件], org:{原欄條件}}; path為該欄之路徑
    function castCond(c, path) {
        let conds = []
        let org = {}
        if (!isOpObj(c)) {
            push(conds, cIn(normVals(c, false, path)))
            return { conds, org }
        }
        for (let k of Reflect.ownKeys(c)) {
            let v = c[k]
            if (k === '$eq') {
                push(conds, cIn(normVals([v], false, path)))
            }
            else if (k === '$in') {
                push(conds, cIn(normVals(v, false, path)))
            }
            else if (k === '$ne') {
                if (v === null) {
                    putProp(org, k, v) //$ne:null不是無效值而是[非NULL], 留於原欄交cvFind轉為IS NOT NULL(LW2)
                }
                else {
                    push(conds, cNin(normVals([v], true, `${path}.$ne`)))
                }
            }
            else if (k === '$nin') {
                push(conds, cNin(normVals(v, true, `${path}.$nin`)))
            }
            else if (OPS_RANGE.indexOf(k) >= 0) {
                putProp(org, k, rangeVal(v))
            }
            else {
                putProp(org, k, v)
            }
        }
        return { conds, org }
    }

    //castObj, inList為是否為邏輯陣列($and、$or)之元素, path為該物件之路徑(與cvOrmFind之路徑同形, 供錯誤訊息)
    function castObj(o, inList, path) {
        if (!isPlainObj(o)) {
            return o
        }
        let rest = {}
        let ands = []
        for (let k of Reflect.ownKeys(o)) {
            let v = o[k]
            if (k === pk) {
                let { conds, org } = castCond(v, `${path}.${k}`)
                ands.push(...conds)
                if (Reflect.ownKeys(org).length > 0) {
                    putProp(rest, k, org)
                }
            }
            else if ((k === '$and' || k === '$or') && Array.isArray(v)) {
                putProp(rest, k, v.map((x, i) => { //map保留陣列之洞, 交cvFind拒收
                    return castObj(x, true, `${path}.${k}[${i}]`)
                }))
            }
            else {
                putProp(rest, k, v)
            }
        }
        if (ands.length === 0) {
            //邏輯陣列之元素不得為空物件(白名單: 空條件reject), 原元素非空而其主鍵條件皆化簡掉者(如$ne僅含不可能存在之值, 必不相等即恆真), 以恆真之序號條件代替
            if (inList && Reflect.ownKeys(rest).length === 0 && Reflect.ownKeys(o).length > 0) {
                return { [wi]: { $nin: [-1] } }
            }
            return rest
        }
        //序號條件併入同一物件(欄位wi之運算子物件), 不增層: 增層會把合法之巢狀深度放大(每層含主鍵條件者放大一倍), 使其後cvFind內之再檢核拒收;
        //同運算子重複(如$eq與$in並列、$ne與$nin並列)或rest已有同名鍵(不可能, wi不與欄位同名)者才另以字串鍵$and置放
        let extra = []
        if (Object.prototype.hasOwnProperty.call(rest, wi)) {
            extra = ands
        }
        else {
            let m = {}
            for (let c of ands) {
                let op = Reflect.ownKeys(c[wi])[0]
                if (Object.prototype.hasOwnProperty.call(m, op)) {
                    extra.push(c)
                }
                else {
                    putProp(m, op, c[wi][op])
                }
            }
            putProp(rest, wi, m)
        }
        if (extra.length === 0) {
            return rest
        }
        return { $and: [rest, ...extra] }
    }

    //find, 非一般物件原樣返回交cvFind拒收(不可能到達, normFind已拒)
    return { find: castObj(find, false, 'find'), slots }
}


/**
 * 依各主鍵值命中之序號就地填入castPkFind之序號佔位陣列
 *
 * 註: 各佔位為其主鍵值命中序號之聯集(遞增); 聯集為空者填入不存在之序號-1($in即不命中、$nin即恆成立), 不留空陣列(cvFind對空集合產生literal)
 *
 * @param {Array} slots 輸入castPkFind回傳之slots
 * @param {Function} idxOf 輸入函數, 給正規化後之主鍵值回傳命中列之序號陣列
 */
function fillPkSlots(slots, idxOf) {
    for (let s of slots) {
        let set = new Set()
        for (let v of s.vals) {
            for (let i of idxOf(v)) {
                set.add(i)
            }
        }
        let is = [...set].sort((a, b) => a - b)
        s.is.push(...(is.length > 0 ? is : [-1]))
    }
}


export {
    TPS_STR,
    TPS_INT,
    TPS_FLT,
    LEN_TEXT_MAX,
    KEY_WI,
    getPkType,
    chkPkWf,
    normPk,
    kFast,
    genInnerKeys,
    isPlainObj,
    castPkFind,
    fillPkSlots
}
