import fs from 'fs'
import path from 'path'
import JSON5 from 'json5'
import Sequelize from 'sequelize'
import each from 'lodash-es/each.js'
import get from 'lodash-es/get.js'
import trim from 'lodash-es/trim.js'
import join from 'lodash-es/join.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import genPm from 'wsemi/src/genPm.mjs'
import requireModel from 'w-orm-reladb/src/requireModel.js'


//匯入資料表設定檔(models)
//
//本模組取代w-orm-reladb之importModels，差異僅在於modifyModel之寫檔方式：
//原版於[每一次]匯入時皆無條件以fs.writeFileSync重寫使用者之model原始檔，
//而本套件每次操作(select/insert/save/del…)皆會匯入一次，故等同每次操作都重寫該檔。
//兩個行程併發操作同一資料表時，一方正截斷檔案而另一方讀取，即讀到空內容，
//匯入失敗且該檔[永久損毀](已實機重現: models/users.js被截為0位元組，其後所有行程之操作全數失敗)。
//
//本版之修正為三：
//  1. 內容未變更者完全不寫檔——model已具主鍵設定時(常態)即不再有任何寫入
//  2. 已具主鍵設定者一律原樣返回而不重新產生內容，令行尾字元(CRLF)與格式皆不被改動；
//     原版係以'\n'重組全檔，Windows之CRLF檔因此每次皆被判定為[有變更]而重寫
//  3. 確需變更者改以[寫暫存檔後rename]之原子寫入，令並行讀取者不會讀到中途狀態


/**
 * 強制js格式之model將id設為主鍵
 *
 * 註: 若id沒有被設定為pk, 則需要強制設為pk, 否則sequelize無法匯入
 *
 * @ignore
 * @param {String} h 輸入model檔內容字串
 * @returns {String} 回傳處理後之內容字串
 */
function forJS(h) {

    //eol, 保留原檔之行尾字元, 否則Windows之CRLF檔會被正規化為LF而每次皆判定為[有變更]
    let eol = h.indexOf('\r\n') >= 0 ? '\r\n' : '\n'

    //s
    let s = h.split(/\r?\n/)

    //find ind
    let indIDs = null
    let indIDe = null
    let indHasPK = false
    each(s, (v, k) => {
        v = trim(v)
        if (v === `'id': {`) {
            indIDs = k
        }
        if (indIDs !== null && indIDe === null && v.indexOf('primaryKey: true') >= 0) {
            indHasPK = true
        }
        if (indIDs !== null && v === '}') {
            indIDe = k
        }
    })

    //check, 無id欄位或已設為主鍵者原樣返回, 令常態下完全不觸碰使用者之原始檔
    if (indIDs === null || indHasPK) {
        return h
    }

    //add primaryKey
    s[indIDs] += 'primaryKey: true,' //用json5轉不用考慮是否最末不補逗號

    return join(s, eol)
}


/**
 * 強制json格式之model將id設為主鍵
 *
 * @ignore
 * @param {String} h 輸入model檔內容字串
 * @returns {String} 回傳處理後之內容字串
 */
function forJSON(h) {

    //s
    let s = JSON5.parse(h)

    //check
    if (!iseobj(get(s, 'fields'))) {
        throw new Error('invalid fields')
    }

    //自動針對id設定為主鍵
    let bMod = false
    each(s.fields, (v, k) => {
        if (k === 'id' && v.primaryKey !== true) {
            v.primaryKey = true
            bMod = true
        }
    })

    //check, 已設為主鍵者原樣返回而不重新序列化, 令常態下完全不觸碰使用者之原始檔
    if (!bMod) {
        return h
    }

    return JSON5.stringify(s, null, 4)
}


/**
 * 視需要修正model檔，令id為主鍵
 *
 * 註: 內容未變更者不寫檔，確需變更者以原子寫入完成，見本檔頭之說明
 *
 * @ignore
 * @param {String} fn 輸入model檔位置字串
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.type='js'] 輸入資料表設定檔類型字串
 * @returns {undefined} 無回傳值
 */
function modifyModel(fn, opt = {}) {

    //type
    let type = get(opt, 'type')
    if (type !== 'js' && type !== 'json') {
        type = 'js'
    }

    //h
    let h = fs.readFileSync(fn, 'utf8')

    //h2
    let h2 = h
    if (type === 'js') {
        h2 = forJS(h)
    }
    else if (type === 'json') {
        h2 = forJSON(h)
    }

    //check, 內容未變更即不寫檔, 令常態下完全不觸碰使用者之原始檔
    if (h2 === h) {
        return
    }

    //write, 以寫暫存檔後rename之原子寫入完成, 令並行讀取者不會讀到中途狀態
    let fnTemp = `${fn}.${process.pid}.tmp`
    try {
        fs.writeFileSync(fnTemp, h2, 'utf8')
        fs.renameSync(fnTemp, fn)
    }
    catch (err) {
        try {
            fs.unlinkSync(fnTemp)
        }
        catch (errDel) {}
        throw err
    }

}


/**
 * 讀取js格式之model
 *
 * @ignore
 */
function readJsModel(fn, sequelize) {
    return requireModel(fn, sequelize, Sequelize.DataTypes)
}


/**
 * 讀取json格式之model
 *
 * @ignore
 */
function readJsonModel(fn, sequelize) {

    //s
    let j = fs.readFileSync(fn, 'utf8')
    let s = JSON5.parse(j)

    //抽換DataTypes, 例如將'DataTypes.TEXT'改為DataTypes.TEXT
    each(s.fields, (v) => {
        v.type = get(Sequelize, v.type, null)
    })

    //model, 使用define產生model
    return sequelize.define(s.table, s.fields, s.options)
}


/**
 * 匯入資料表設定檔
 *
 * @param {String} fdModels 輸入models所在資料夾字串
 * @param {Object} sequelize 輸入sequelize實例
 * @param {String} name 輸入資料表名稱字串
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.type='js'] 輸入資料表設定檔類型字串，可有'js'、'json'
 * @param {Boolean} [opt.sync=false] 輸入是否將models資料同步至資料庫
 * @returns {Promise} 回傳Promise，resolve回傳models物件，reject回傳錯誤訊息
 */
async function importModels(fdModels, sequelize, name, opt = {}) {

    //type
    let type = get(opt, 'type')
    if (type !== 'js' && type !== 'json') {
        type = 'js'
    }

    //sync
    let sync = get(opt, 'sync') === true

    //pm
    let pm = genPm()

    //fn
    let fn = path.resolve(fdModels) + path.sep + `${name}.${type}`

    //modifyModel
    try {
        modifyModel(fn, { type })
    }
    catch (err) {
        pm.reject(err)
        return pm
    }

    //import
    let model
    try {
        if (type === 'js') {
            model = readJsModel(fn, sequelize)
        }
        else if (type === 'json') {
            model = readJsonModel(fn, sequelize)
        }
    }
    catch (err) {
        pm.reject(err)
        return pm
    }

    //sync
    try {
        if (sync) {
            await model.sync()
        }
    }
    catch (err) {
        pm.reject(err)
        return pm
    }

    //models
    let models = {}
    models[model.name] = model

    //resolve
    pm.resolve(models)

    return pm
}


export default importModels
