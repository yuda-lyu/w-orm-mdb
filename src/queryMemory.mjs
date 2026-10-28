import Sequelize from 'sequelize'
import each from 'lodash-es/each.js'
import get from 'lodash-es/get.js'
import isarr from 'wsemi/src/isarr.mjs'
import arrHas from 'wsemi/src/arrHas.mjs'
import pm2resolve from 'wsemi/src/pm2resolve.mjs'
import cvFind, { getColKind, toFloating } from 'w-orm-reladb/src/cvFind.mjs'
import importModels from './importModels.mjs'
import { TPS_STR, genInnerKeys } from './pk.mjs'


/**
 * 初始化sequelize
 *
 * 註: 本實例僅用於由sequelize產生SQL文字(見getCmd.mjs), 實際數據操作一律交Jet引擎,
 * 故其資料表為記憶體sqlite且不承載任何數據
 *
 * 註: logging只在opt.logging為true且給予logSql時啟用, 且一律為函數(R-DIAG-04): 傳true時sequelize以console.log輸出sql全文(含欄位值與條件值)並觸發deprecation警告,
 * 輸出須經getDiag之單一出口, 故不直接傳true
 *
 * @param {Object} opt 輸入設定物件
 * @param {Function} [logSql=null] 輸入sequelize之logging函數(sql全文), 未給則不輸出
 * @returns {Promise} 回傳Promise，resolve回傳{sequelize,mds}
 */
async function initSequelize(opt, logSql = null) {

    //sequelize, 需使用物件式設定, 若用連線字串[sqlite::memory:]因非合法URL, 會被node的url.parse觸發DEP0170棄用警告
    let setOpt = {
        dialect: 'sqlite',
        storage: ':memory:',
        logging: opt.logging === true && typeof logSql === 'function' ? logSql : false,
        define: {
            timestamps: false
        },
        //sync: { force: true }, //強制同步
    }
    let sequelize = new Sequelize(setOpt)

    //importModels, 若model內opt.pk欄不是pk則需要強制更改成為pk, 否則sequelize無法匯入
    //註: 不需sync, 因本實例僅供讀取欄位定義(rawAttributes), 不於其上執行任何查詢
    //註: 須傳入opt.pk, 否則importModels只認id欄, 主鍵另名而model另有非主鍵欄id時會把id改為主鍵並改寫使用者之model檔
    let r = await pm2resolve(importModels)(opt.fdModels, sequelize, opt.cl, { sync: false, type: opt.modelType, pk: opt.pk })

    //check, 匯入失敗時此處建立之sequelize不會回傳給呼叫端, 須在此關閉(R-LIFE)
    if (r.state === 'error') {
        await sequelize.close()
        let err = `can not import model: ${opt.cl}, need to use genModelsByDB, genModelsByTabs or create ${opt.cl}.${opt.modelType}`
        return Promise.reject(err)
    }

    return {
        sequelize,
        mds: r.msg,
    }
}


/**
 * 取記憶體過濾表所用之欄位型別
 *
 * 字串類欄位一律改為CITEXT，於sqlite即[TEXT COLLATE NOCASE]，令比對不分大小寫
 * 註: Jet引擎之字串比對不分大小寫(已實測'ID-PETER'命中'id-peter'，且主鍵唯一約束亦視兩者為同一鍵)，
 * 而sqlite預設之BINARY定序分大小寫。記憶體過濾層係模擬後端行為之實作細節，
 * 若不對齊將出現[selectByPk命中而select({主鍵})查無]之矛盾，與規格[命中判定基準須一致]相違
 * 註: sqlite之NOCASE僅折疊ASCII之A-Z且不忽略尾端空白，故主鍵之等值條件不在此比對，而由castPkFind改寫為以Jet判定之命中列序號(見WOrmMdb.mjs之resolvePkIdx)，
 * 本函數之CITEXT僅決定非主鍵字串欄與主鍵之範圍比較之語意
 *
 * @ignore
 * @param {Object} tp 輸入原欄位型別物件
 * @returns {Object} 回傳供記憶體過濾表使用之欄位型別物件
 */
function getTypeNocase(tp) {

    //key
    let k = get(tp, 'key', '')

    //check, 非字串類者維持原型別; 字串類清單與procPk、normPk共用(含UUID)
    if (!arrHas(k, TPS_STR)) {
        return tp
    }

    return Sequelize.CITEXT
}


/**
 * 核對條件只引用被model宣告為白名單欄型之欄(R-FLOAT-07, 原LFL5、LFL7)
 *
 * 白名單欄型: reladb之getColKind分類為str(STRING、TEXT、CHAR、CITEXT、UUID)、int(INTEGER、BIGINT、SMALLINT、MEDIUMINT、TINYINT)、
 * num(FLOAT、REAL、DOUBLE、DECIMAL、NUMBER)、date(DATE)、dateonly(DATEONLY)、bool(BOOLEAN)者，即Jet欄型可對應者；
 * 其餘(any: TIME、ENUM、JSON、JSONB、BLOB、UUIDV1、UUIDV4、NOW、ARRAY、RANGE、GEOMETRY、GEOGRAPHY、HSTORE、INET、CIDR、MACADDR、TSVECTOR)被條件引用者一律拒收
 * 註: Jet欄型只有文字、數值、日期時間、是否等，沒有上列型別(TIME更無[僅時間]型別)，於model宣告者必為誤宣告或無法對應；
 * reladb之getColKind將其歸any(不換算日期、不檢核值型別)，記憶體過濾表之欄亦不是CITEXT，條件交sqlite比較而與Jet原生不同(真Jet實測):
 * 文字欄分大小寫(delAll({name:{$ne:'APPLE'}})多刪apple)、日期時間欄以文字比較(空白分隔與T不等，$ne多命中)、
 * TIME之delAll({dt:{$gt:'12:00:00'}})多刪早於12:00之列、ENUM/BLOB宣告於DOUBLE欄時數值依文字序比較。
 * 本套件不改寫非主鍵條件(R-FIND-00)，故改為fail-closed；欄須如實宣告為上列白名單欄型(Jet之DATETIME宣告為DATE，時間值以1899-12-30為日期)
 * 註: 以屬性名或資料庫欄名(attr.field)完全相符解析欄位(與cvFind之嚴格鍵一致，歧義與不存在者留給cvFind拒收)；以getColKind(含type.key後備)判定而不用instanceof(重複安裝兩份sequelize時instanceof為假)；
 * VIRTUAL非資料庫欄，不在此判，交cvFind以unknown column name拒收；路徑格式同cvFind之find.欄名，
 * 訊息固定詞彙(型別名稱取自model之type.key，非條件值；無法辨識者為unknown)而不回顯條件值；不引用該欄者(含空條件)不受影響
 * 註: 須於讀取全表與寫入前呼叫(見WOrmMdb.mjs之findAll)，令拒收時不讀、不寫、不刪
 *
 * @param {Object} attrs 輸入資料表欄位定義物件，取自model之rawAttributes
 * @param {Object} find 輸入查詢條件物件(normFind回傳之複本)
 * @param {String} [path='find'] 輸入訊息所用之路徑前綴，供遞迴使用
 * @throws {Error} 引用非白名單欄型之欄時拋出invalid find: column type <型別> is not supported at [路徑]
 */
function chkFindColKind(attrs, find, path = 'find') {

    //attrs
    attrs = attrs || {}

    //check
    if (find === null || typeof find !== 'object' || Array.isArray(find)) {
        return
    }

    //typeOf, 屬性名優先, 否則以資料庫欄名解析; 回傳非白名單欄型之名稱, 白名單欄型與VIRTUAL回傳null
    let typeOf = (name) => {
        let ans = [name]
        if (!Object.prototype.hasOwnProperty.call(attrs, name)) {
            ans = Object.keys(attrs).filter((k) => {
                return get(attrs, [k, 'field']) === name
            })
        }
        for (let a of ans) {
            if (getColKind(attrs, a) !== 'any') {
                continue
            }
            let key = get(attrs, [a, 'type', 'key'])
            if (key === 'VIRTUAL') {
                continue
            }
            if (typeof key === 'string' && /^[A-Z][A-Z0-9 _]{0,31}$/.test(key)) {
                return key
            }
            return 'unknown'
        }
        return null
    }

    for (let k of Object.keys(find)) {
        let v = find[k]
        let kp = `${path}.${k}`
        if (k === '$and' || k === '$or') {
            if (isarr(v)) {
                v.forEach((x, i) => {
                    chkFindColKind(attrs, x, `${kp}[${i}]`)
                })
            }
        }
        else if (k[0] !== '$') {
            let t = typeOf(k)
            if (t !== null) {
                throw new Error(`invalid find: column type ${t} is not supported at [${kp}]`)
            }
        }
    }

}


/**
 * 於記憶體內過濾數據
 *
 * 因Access之SQL方言不支援$in、$nin等條件，故由Jet取回全部數據後於記憶體sqlite內過濾
 *
 * 註: 主鍵之等值類條件已由castPkFind改寫為原列序號欄keys.wi之$in/$nin(序號由Jet判定命中列)，
 * 令尾端空白、全半形、平片假名、非ASCII大小寫等變體之命中與selectByPk、insert、save、del一致
 * 註: 條件由w-orm-reladb之cvFind轉譯(非主鍵條件之欄位型別/DATE/嚴格鍵單一擁有者; 運算子白名單與形狀層由wsemi之cvOrmFind檢核, 入口已於WOrmMdb.mjs之normFind完成, cvFind對複本再檢核一次, 冪等)，
 * ctx依其帳本之深引用者接線契約: attrs取過濾表本身之rawAttributes(字串欄為CITEXT、含序號欄)、
 * dateNoTz為'floating'(Jet之DATETIME為無時區牆上時間: 條件值一律換算為牆上時間分量再作為UTC瞬間, 與主機時區無關)；不傳pk(主鍵等值由Jet判定, 不交sqlite)；
 * reladb 1.1.10起ctx.escape與ctx.dialect已不使用($regex已移除), 故不傳
 * 註: 浮動時間之契約(reladb帳本R14, 本套件帳本R-FLOAT): ①數據側須同進同退——DATE欄之資料值(Jet回傳之牆上時間字串)入表前一律經toFloating換算為同一空間，
 * 混用(條件走floating而數據未換算)為靜默誤命中，故二者同在本函數；②toFloating回傳null者(無法換算)整批拒收，不得以原值或NULL代入
 * (NULL使該列於範圍條件不命中而IS NULL命中，與要修之誤刪同型)，null/undefined之值不動；③記憶體表之Date為編碼後之浮動時間，不得回傳或回灌為條件
 * (本函數回傳Jet原列而非記憶體表之Date)；DATE欄之判定與cvFind條件側同用reladb之getColKind(單一擁有者)
 * 註: 修前('local')於負偏移時區主機，Jet本地9999年末之哨兵列(9999-12-31 23:59:59)換算為UTC年10000而使範圍條件結果錯誤、delAll誤刪(原已知限制LF8)，夏令跳過之牆上時刻亦被正規化(原LF4)；浮動時間皆已解
 * 註: 原列序號欄之名稱由呼叫端以genInnerKeys產生(附加亂數)，與castPkFind所用者須相同，且不與使用者之欄位或條件同名
 * 註: 過濾表以原列序號keys.wi為主鍵，主鍵欄不設主鍵與唯一；
 * 結果依序號取回Jet之原列並依Jet回傳序排列，故select之內容即Jet原值(如DATE欄之字串、BOOLEAN欄之true/false)，
 * 與selectByPk相同，而非經sqlite往返轉換之值
 *
 * @param {Object} opt 輸入設定物件
 * @param {Object} attrs 輸入資料表欄位定義物件，取自model之rawAttributes
 * @param {Array} data 輸入待過濾之數據陣列
 * @param {Object} find 輸入查詢條件物件，主鍵條件須已經castPkFind改寫，其餘為呼叫端之原始條件
 * @param {Object} [keys] 輸入原列序號欄之名稱{wi}，未給則自行產生(此時條件不得引用序號欄)
 * @param {Function} [logSql=null] 輸入sequelize之logging函數(sql全文含過濾表之欄位值與條件值, 見initSequelize之說明)，未給則不輸出
 * @returns {Promise} 回傳Promise，resolve回傳過濾後之數據陣列(Jet原列)，條件不合法時reject
 */
async function queryMemory(opt, attrs, data, find, keys, logSql = null) {

    //keys
    if (!keys) {
        keys = genInnerKeys(attrs)
    }

    //check
    if (!isarr(data)) {
        return Promise.reject('data is not an array')
    }

    //sequelize
    let setOpt = {
        dialect: 'sqlite',
        storage: ':memory:',
        logging: opt.logging === true && typeof logSql === 'function' ? logSql : false,
        define: {
            timestamps: false
        },
    }
    let sequelize = new Sequelize(setOpt)

    //cols, Jet列實有之欄名(connMDB.exe每列輸出全部欄位, 值為NULL者亦有其鍵, 故取首列); 無列時無從得知, 不篩選
    let cols = data.length > 0 ? new Set(Object.keys(data[0] || {})) : null

    //defs, 由來源model之欄位定義衍生, 字串類改CITEXT令比對不分大小寫以對齊Jet
    //註: model有而Jet列無之屬性(model過時、欄名大小寫不符)不納入過濾表, 引用之條件由cvFind以嚴格鍵拒收;
    //否則該欄於過濾表恆為NULL, {欄:null}、$exists:false等條件命中全部列而使delAll刪光全表(run02外審opus)
    let defs = {}
    each(attrs, (at, k) => {
        if (cols !== null && !cols.has(k)) {
            return
        }
        defs[k] = {
            type: getTypeNocase(get(at, 'type')),
            primaryKey: false,
            allowNull: true, //過濾表不承擔約束, 以免來源數據觸發非預期失敗
        }
    })

    //原列序號為主鍵, 有主鍵故sequelize不會自行添加id欄位
    defs[keys.wi] = {
        type: Sequelize.INTEGER,
        primaryKey: true,
    }

    //md, 自行定義而不重新匯入models, 省一次匯入且得指定定序
    let md = sequelize.define(opt.cl, defs, {
        tableName: opt.cl,
        timestamps: false,
    })

    let ts
    try {

        //where, 以cvFind轉譯, 條件不合法時拋錯; 先於寫入數據, 拒收時不做無謂之寫入
        let where = cvFind(find, {
            attrs: md.rawAttributes,
            dateNoTz: 'floating',
        })

        //sync
        await md.sync()

        //dateCols, DATE欄(與cvFind條件側同用getColKind判定, 令兩側對DATE欄之認定一致)
        let dateCols = Object.keys(md.rawAttributes).filter((k) => {
            return k !== keys.wi && getColKind(md.rawAttributes, k) === 'date'
        })

        //bulkCreate, DATE欄之值經toFloating換算為浮動時間(牆上時間分量作為UTC瞬間), 與條件側(dateNoTz:'floating')處於同一空間
        //換算失敗(null)者整批拒收, 不得以原值或NULL代入; null與undefined不動(訊息不回顯值)
        let rows = data.map((v, i) => {
            let r = { ...v, [keys.wi]: i }
            for (let k of dateCols) {
                let x = r[k]
                if (x === null || x === undefined) {
                    continue
                }
                let t = toFloating(x)
                if (t === null) {
                    throw new Error(`invalid data: date can not be converted to floating time at [row[${i}].${k}]`)
                }
                r[k] = t
            }
            return r
        })
        await md.bulkCreate(rows)

        //findAll, 只取原列序號
        ts = await md.findAll({
            where,
            attributes: [keys.wi],
            raw: true,
        })

    }
    finally {

        //close, 條件拒收或查詢失敗時亦關閉
        await sequelize.close()

    }

    //rs, 依序號取回Jet原列並依Jet回傳序排列
    let inds = ts.map((v) => {
        return v[keys.wi]
    })
    inds.sort((a, b) => {
        return a - b
    })
    let rs = inds.map((i) => {
        return data[i]
    })

    return rs
}


export { initSequelize, queryMemory, chkFindColKind }
