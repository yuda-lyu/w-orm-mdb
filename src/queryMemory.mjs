import Sequelize from 'sequelize'
import each from 'lodash-es/each.js'
import get from 'lodash-es/get.js'
import isarr from 'wsemi/src/isarr.mjs'
import arrHas from 'wsemi/src/arrHas.mjs'
import pm2resolve from 'wsemi/src/pm2resolve.mjs'
import importModels from './importModels.mjs'
import { TPS_STR, genInnerKeys } from './pk.mjs'


/**
 * 初始化sequelize
 *
 * 註: 本實例僅用於由sequelize產生SQL文字(見getCmd.mjs), 實際數據操作一律交Jet引擎,
 * 故其資料表為記憶體sqlite且不承載任何數據
 *
 * @param {Object} opt 輸入設定物件
 * @returns {Promise} 回傳Promise，resolve回傳{sequelize,mds}
 */
async function initSequelize(opt) {

    //sequelize, 需使用物件式設定, 若用連線字串[sqlite::memory:]因非合法URL, 會被node的url.parse觸發DEP0170棄用警告
    let setOpt = {
        dialect: 'sqlite',
        storage: ':memory:',
        logging: opt.logging,
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

    //check
    if (r.state === 'error') {
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
 * 本函數之CITEXT僅決定非主鍵字串欄與主鍵之範圍比較、$regex之語意
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
 * 於記憶體內過濾數據
 *
 * 因Access之SQL方言不支援$in、$nin、$regex等條件，故由Jet取回全部數據後於記憶體sqlite內過濾
 *
 * 註: 主鍵之等值類條件已由castPkFind改寫為原列序號欄keys.wi之$in/$nin(序號由Jet判定命中列)，
 * 令尾端空白、全半形、平片假名、非ASCII大小寫等變體之命中與selectByPk、insert、save、del一致
 * 註: 原列序號欄之名稱由呼叫端以genInnerKeys產生(附加亂數)，與castPkFind所用者須相同，且不與使用者之欄位或條件同名
 * 註: 過濾表以原列序號keys.wi為主鍵，主鍵欄不設主鍵與唯一；
 * 結果依序號取回Jet之原列並依Jet回傳序排列，故select之內容即Jet原值(如DATE欄之字串、BOOLEAN欄之true/false)，
 * 與selectByPk相同，而非經sqlite往返轉換之值
 *
 * @param {Object} opt 輸入設定物件
 * @param {Object} attrs 輸入資料表欄位定義物件，取自model之rawAttributes
 * @param {Array} data 輸入待過濾之數據陣列
 * @param {Object} useFind 輸入已轉譯為sequelize運算子之查詢條件物件，主鍵條件須已經castPkFind處理
 * @param {Object} [keys] 輸入原列序號欄之名稱{wi}，未給則自行產生(此時條件不得引用序號欄)
 * @returns {Promise} 回傳Promise，resolve回傳過濾後之數據陣列(Jet原列)
 */
async function queryMemory(opt, attrs, data, useFind, keys) {

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
        logging: opt.logging,
        define: {
            timestamps: false
        },
    }
    let sequelize = new Sequelize(setOpt)

    //defs, 由來源model之欄位定義衍生, 字串類改CITEXT令比對不分大小寫以對齊Jet
    let defs = {}
    each(attrs, (at, k) => {
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

    //sync
    await md.sync()

    //bulkCreate
    let rows = data.map((v, i) => {
        return { ...v, [keys.wi]: i }
    })
    await md.bulkCreate(rows)

    //findAll, 只取原列序號
    let ts = await md.findAll({
        where: useFind,
        attributes: [keys.wi],
        raw: true,
    })

    //close
    if (sequelize !== null) {
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


export { initSequelize, queryMemory }
