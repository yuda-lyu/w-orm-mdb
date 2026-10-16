import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'


//主鍵之型別判定、正規化與等值判定之輔助
//
//本模組為[何謂字串型別/有效主鍵/主鍵等值]之唯一擁有者, 其他模組不得另寫同類判定(見CLAUDE_rulebook.md之R-PK)。
//主鍵等值一律以Jet唯一索引之判定為準, 本模組只負責:
//  1. normPk: 依主鍵欄型別正規化主鍵值, 並判定無效、型別不符與不可能存在
//  2. kFast: 快速對應鍵, 只會少判不會多判, 對不上者另以Jet之=查詢判定(insert撞鍵核對與select/delAll之主鍵條件共用)
//  3. castPkFind: 把查詢條件內之主鍵等值類條件改寫為[命中列之序號集合], 序號集合由呼叫端以Jet判定後提供
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
 * 故先以valueOf取出原始值, 令其與原始值同處置
 *
 * @ignore
 */
function unwrap(v) {
    if (v !== null && typeof v === 'object') {
        let c = Object.prototype.toString.call(v)
        if (c === '[object String]' || c === '[object Number]') {
            return v.valueOf()
        }
    }
    return v
}


/**
 * 字串是否無法如實存放於Jet: 含NUL(SQL文字於NUL被截斷)或非良構UTF-16(孤立代理被換為U+FFFD)
 *
 * @ignore
 */
function isUnstorable(s) {
    if (s.indexOf('\u0000') >= 0) {
        return true
    }
    return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)
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
 *
 * @param {*} v 輸入主鍵值
 * @param {String} tp 輸入主鍵欄型別類別, 取自getPkType
 * @returns {Object} 回傳{kind,v}
 */
function normPk(v, tp) {

    //unwrap
    v = unwrap(v)

    //string
    if (typeof v === 'string') {
        if (v === '') {
            return { kind: 'invalid' }
        }
        if (isUnstorable(v)) {
            return { kind: 'cannot' }
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
    throw new Error('can not generate inner keys for memory filter')
}


/**
 * 物件是否為運算子物件(含任一$開頭之鍵); 否則視為一般值(如{}), 屬無效主鍵值
 *
 * @ignore
 */
function isOpObj(c) {
    if (!isobj(c)) {
        return false
    }
    return Object.keys(c).some((k) => {
        return k.indexOf('$') === 0
    })
}


/**
 * 改寫查詢條件內之主鍵條件
 *
 * 註: 主鍵等值類條件(隱含等值、陣列值、$eq、$ne、$in、$nin, 及其下之$not)改寫為原列序號欄wi之$in/$nin,
 * 序號集合由idxOf(正規化後之主鍵值)提供(呼叫端以Jet判定命中列), 故命中判定與selectByPk、del等一致, 不經任何近似鍵
 * 註: 範圍運算子($gt、$gte、$lt、$lte)以正規化值留於原欄比對(記憶體sqlite之語意, 為近似), $regex等其餘運算子原樣留於原欄
 * 註: 肯定語境之無效、型別不符、不可能存在之值不命中; 否定語境($ne、$nin、$not, 以及頂層$not與$nor之內)之無效或型別不符之值一律拋出:
 * 依[無效值不命中]推得之否定為[全部命中], 用於delAll即清空全表, 而此類值多為呼叫端之錯誤(如變數為undefined);
 * 修正前sequelize對undefined亦為reject, 故拋出不使既有呼叫改為刪光全表; 不可能存在之值於否定語境依其語意為必不相等
 * 註: 非運算子物件(如{})視為主鍵值而非條件, 屬無效值, 不得因其無運算子而使主鍵條件消失(修正初版即因此使delAll({id:{}})刪光全表)
 * 註: 主鍵所衍生之條件一律併入同層之$and, 以免與既有鍵或彼此覆寫
 * 註: 僅處理主鍵欄, 其餘欄位與運算子原樣返回(條件轉譯本身另議, 不在本函數範圍)
 * 註: 本函數為純函數, 呼叫端得先以記錄用之idxOf跑一次取得全部主鍵值(並觸發否定語境之檢核), 解析後再以實際idxOf改寫
 *
 * @param {Object} find 輸入mongo風格之查詢條件
 * @param {String} pk 輸入主鍵欄位名
 * @param {String} tp 輸入主鍵欄型別類別
 * @param {String} wi 輸入原列序號欄名稱, 取自genInnerKeys
 * @param {Function} idxOf 輸入函數, 給正規化後之主鍵值回傳命中列之序號陣列
 * @returns {Object} 回傳改寫後之查詢條件
 */
function castPkFind(find, pk, tp, wi, idxOf) {

    //err, 否定語境之無效值
    function err(v) {
        return new Error(`invalid ${pk} in negative condition: ${String(v)}`)
    }

    //idxs, 單一值之命中序號; neg為否定語境
    function idxs(v, neg) {
        let r = normPk(v, tp)
        if (r.kind === 'ok') {
            return idxOf(r.v)
        }
        if (neg && (r.kind === 'invalid' || r.kind === 'mismatch')) {
            throw err(v)
        }
        return []
    }

    //idxsArr, 多值之命中序號聯集; 純量視為單元素陣列
    function idxsArr(vs, neg) {
        if (!isarr(vs)) {
            vs = [vs]
        }
        let s = new Set()
        each(vs, (v) => {
            each(idxs(v, neg), (i) => {
                s.add(i)
            })
        })
        return [...s]
    }

    //cIn, cNin, 序號條件; 空集合之$in以不存在之序號表示必不命中, 空集合之$nin為恆成立而不加條件
    function cIn(is) {
        return { [wi]: { $in: is.length > 0 ? is : [-1] } }
    }
    function cNin(is) {
        if (is.length === 0) {
            return null
        }
        return { [wi]: { $nin: is } }
    }

    //normVal, 範圍運算子之值
    function normVal(v, neg) {
        let r = normPk(v, tp)
        if (r.kind === 'ok') {
            return r.v
        }
        if (neg && (r.kind === 'invalid' || r.kind === 'mismatch')) {
            throw err(v)
        }
        return null
    }

    //push
    function push(conds, c) {
        if (c) {
            conds.push(c)
        }
    }

    //castNot, 主鍵欄之$not, 等值類依De Morgan轉為序號條件, 範圍類留於原欄
    function castNot(v, conds, org) {
        if (!isOpObj(v)) {
            push(conds, cNin(isarr(v) ? idxsArr(v, true) : idxs(v, true)))
            return
        }
        let orgNot = {}
        each(v, (vv, kk) => {
            if (kk === '$eq') {
                push(conds, cNin(idxs(vv, true)))
            }
            else if (kk === '$in') {
                push(conds, cNin(idxsArr(vv, true)))
            }
            else if (kk === '$ne') {
                push(conds, cIn(idxs(vv, true)))
            }
            else if (kk === '$nin') {
                push(conds, cIn(idxsArr(vv, true)))
            }
            else if (['$gt', '$gte', '$lt', '$lte'].indexOf(kk) >= 0) {
                orgNot[kk] = normVal(vv, true)
            }
            else {
                orgNot[kk] = vv
            }
        })
        if (Object.keys(orgNot).length > 0) {
            org['$not'] = orgNot
        }
    }

    //castCond, 主鍵欄之條件, 回傳{conds:[序號條件], org:{原欄條件}}
    function castCond(c, neg) {
        let conds = []
        let org = {}
        if (!isOpObj(c)) {
            push(conds, cIn(isarr(c) ? idxsArr(c, neg) : idxs(c, neg)))
            return { conds, org }
        }
        each(c, (v, k) => {
            if (k === '$eq') {
                push(conds, cIn(idxs(v, neg)))
            }
            else if (k === '$in') {
                push(conds, cIn(idxsArr(v, neg)))
            }
            else if (k === '$ne') {
                push(conds, cNin(idxs(v, true)))
            }
            else if (k === '$nin') {
                push(conds, cNin(idxsArr(v, true)))
            }
            else if (k === '$not') {
                castNot(v, conds, org)
            }
            else if (['$gt', '$gte', '$lt', '$lte'].indexOf(k) >= 0) {
                org[k] = normVal(v, neg)
            }
            else {
                org[k] = v
            }
        })
        return { conds, org }
    }

    //castObj, neg為是否位於頂層$not或$nor之內
    function castObj(o, neg) {
        if (!isobj(o)) {
            return o
        }
        let r = {}
        let ands = []
        each(o, (v, k) => {
            if (k === pk) {
                let { conds, org } = castCond(v, neg)
                each(conds, (c) => {
                    ands.push(c)
                })
                if (Object.keys(org).length > 0) {
                    r[k] = org
                }
            }
            else if ((k === '$and' || k === '$or') && isarr(v)) {
                r[k] = v.map((x) => {
                    return castObj(x, neg)
                })
            }
            else if (k === '$nor' && isarr(v)) {
                r[k] = v.map((x) => {
                    return castObj(x, true)
                })
            }
            else if (k === '$not' && isobj(v)) {
                r[k] = castObj(v, true)
            }
            else {
                r[k] = v
            }
        })
        if (ands.length > 0) {
            r['$and'] = isarr(r['$and']) ? [...r['$and'], ...ands] : ands
        }
        return r
    }

    return castObj(isobj(find) ? find : {}, false)
}


export {
    TPS_STR,
    TPS_INT,
    TPS_FLT,
    LEN_TEXT_MAX,
    KEY_WI,
    getPkType,
    normPk,
    kFast,
    genInnerKeys,
    castPkFind
}
