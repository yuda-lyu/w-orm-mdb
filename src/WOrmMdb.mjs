import path from 'path'
import events from 'events'
import Sequelize from 'sequelize'
import Adodb from 'node-adodb'
import cloneDeep from 'lodash-es/cloneDeep.js'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import split from 'lodash-es/split.js'
import genPm from 'wsemi/src/genPm.mjs'
import genID from 'wsemi/src/genID.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import pmQueue from 'wsemi/src/pmQueue.mjs'
import _genModelsByTabs from 'w-orm-reladb/src/genModelsByTabs.mjs'
import { getSelect, getInsert, getUpdate, getDelete } from './getCmd.mjs'
import { initSequelize, queryMemory } from './queryMemory.mjs'


//放置於全域宣告, 若使用useStable=true才可於當創建多實例時仍能全域控管
let pmq = pmQueue(1)


/**
 * 操作關聯式資料庫
 *
 * @class
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.url='mdb://username:password'] 輸入連接資料庫字串，資料庫僅可選'mdb'，預設'mdb://username:password'
 * @param {String} [opt.storage='./worm.db'] 輸入mdb資料庫檔案位置字串，預設'./worm.db'
 * @param {Boolean} [opt.useEncryption=false] 輸入是否使用加密保護，型別為布林值，預設false
 * @param {String} [opt.db='worm'] 輸入使用資料庫名稱字串，mdb並不需要給只是配合w-orm系列統一設定，預設'worm'
 * @param {String} [opt.cl='test'] 輸入使用資料表名稱字串，預設'test'
 * @param {String} [opt.fdModels='./models'] 輸入資料表設定檔所在資料夾字串，預設'./models'
 * @param {String} [opt.dbType='Access2007'] 輸入使用資料庫類型字串，可選'Access2000-2003'、'Access2007'，預設'Access2007'
 * @param {String} [opt.modelType='js'] 輸入資料表設定檔類型字串，可有'js'、'json'，預設'js'
 * @param {Boolean} [opt.logging=false] 輸入是否輸出實際執行的sql指令布林值，預設false
 * @param {String} [opt.pk='id'] 輸入數據主鍵字串，預設'id'
 * @param {Boolean} [opt.autoGenPK=true] 輸入若數據pk(id)欄位沒給時則自動給予隨機uuid，型別為布林值，預設true
 * @param {Boolean} [opt.useStable=true] 輸入是否使用穩定模式，使用佇列管理同時只能進行一種操作故會犧牲效能，mdb需開啟穩定模式才不會有非預期錯誤，型別為布林值，預設true
 * @returns {Object} 回傳操作資料庫物件，各事件功能詳見說明
 */
function WOrmMdb(opt = {}) {
    let ss
    let u
    let sequelize = null
    let adodb = null


    //default
    if (!isestr(opt.url)) {
        opt.url = 'mdb://username:password'
    }
    if (!isestr(opt.db)) {
        opt.db = 'worm'
    }
    if (!isestr(opt.cl)) {
        opt.cl = 'test'
    }
    if (!isestr(opt.fdModels)) {
        opt.fdModels = './models'
    }
    if (!isestr(opt.modelType)) {
        opt.modelType = 'js'
    }
    opt.logging = (opt.logging === true)
    if (!isestr(opt.pk)) {
        opt.pk = 'id'
    }
    if (!isbol(opt.autoGenPK)) {
        opt.autoGenPK = true
    }
    if (!isbol(opt.useStable)) {
        opt.useStable = true
    }
    if (!isestr(opt.storage)) {
        opt.storage = './worm.mdb'
    }
    opt.storage = path.resolve(opt.storage)
    if (opt.dbType !== 'Access2000-2003' && opt.dbType !== 'Access2007' && opt.dbType !== 'Access2016') {
        opt.dbType = 'Access2007'
    }
    if (!isbol(opt.useEncryption)) {
        opt.useEncryption = false
    }


    //Op
    let Op = Sequelize.Op
    // let operatorsAliases = {
    //     $eq: Op.eq,
    //     $ne: Op.ne,
    //     $gte: Op.gte,
    //     $gt: Op.gt,
    //     $lte: Op.lte,
    //     $lt: Op.lt,
    //     $not: Op.not,
    //     $in: Op.in,
    //     $notIn: Op.notIn,
    //     $is: Op.is,
    //     $like: Op.like,
    //     $notLike: Op.notLike,
    //     $iLike: Op.iLike,
    //     $notILike: Op.notILike,
    //     $regexp: Op.regexp,
    //     $notRegexp: Op.notRegexp,
    //     $iRegexp: Op.iRegexp,
    //     $notIRegexp: Op.notIRegexp,
    //     $between: Op.between,
    //     $notBetween: Op.notBetween,
    //     $overlap: Op.overlap,
    //     $contains: Op.contains,
    //     $contained: Op.contained,
    //     $adjacent: Op.adjacent,
    //     $strictLeft: Op.strictLeft,
    //     $strictRight: Op.strictRight,
    //     $noExtendRight: Op.noExtendRight,
    //     $noExtendLeft: Op.noExtendLeft,
    //     $substring: Op.substring,
    //     $and: Op.and,
    //     $or: Op.or,
    //     $any: Op.any,
    //     $all: Op.all,
    //     $values: Op.values,
    //     $col: Op.col
    // }


    //ee
    let ee = new events.EventEmitter()


    //dialect
    let dialect
    ss = split(opt.url, '://')
    dialect = get(ss, 0, null)
    if (!dialect) {
        console.log('no dialect in opt.url')
        return ee
    }
    if (dialect !== 'mdb') {
        console.log(`dialect[${dialect}] is not mdb`)
        return ee
    }
    u = get(ss, 1, '') //另存給後面使用


    //username, password
    let username
    let password
    ss = split(u, '@')
    u = get(ss, 1, '') //另存給後面使用
    ss = get(ss, 0, '')
    ss = split(ss, ':')
    if (size(ss) !== 2) {
        console.log('invalid username or password in opt.url')
        return ee
    }
    username = get(ss, 0, '')
    password = get(ss, 1, '')
    if (opt.useEncryption) {
        if (username === '') {
            console.log('invalid username in opt.url')
            return ee
        }
        if (password === '') {
            console.log('invalid password in opt.url')
            return ee
        }
    }


    /**
     * 初始化adodb
     *
     * @memberOf WOrmMdb
     * @returns {Promise} 回傳Promise，resolve代表關閉成功，reject回傳錯誤訊息
     */
    async function initAdodb() {
        let err = null

        //provider
        let kpProvider = {
            'Access2000-2003': 'Microsoft.Jet.OLEDB.4.0',
            'Access2007': 'Microsoft.ACE.OLEDB.12.0',
            'Access2016': 'Microsoft.ACE.OLEDB.16.0',
        }
        let provider = kpProvider[opt.dbType]
        // console.log('provider', provider)

        //databasePassword
        let databasePassword = ''
        if (opt.useEncryption) {
            let up = `${username}:${password}`
            databasePassword = ` Jet OLEDB:Database Password=${up};`
        }

        //strConn
        let strConn = `Provider=${provider};Data Source=${opt.storage};Persist Security Info=False;${databasePassword}`
        // console.log('strConn', strConn)

        //adodb, open for x64 記憶體才能支撐讀大檔
        adodb = Adodb.open(strConn, true)
        // console.log('adodb', adodb)

        //initSequelize
        let r = await initSequelize(opt)

        //save
        sequelize = r.sequelize
        let mds = r.mds

        return {
            mds,
            err,
            close: () => {
                return closeSequelize('external')
            },
        }
    }


    /**
     * 關閉sequelize
     *
     * @memberOf WOrmReladb
     * @returns {Promise} 回傳Promise，resolve代表關閉成功，reject回傳錯誤訊息
     */
    async function closeSequelize(from) {
        if (sequelize !== null) {
            await sequelize.close()
            //console.log(from, 'sequelize.close()')
        }
        sequelize = null
        //console.log(from, 'sequelize = null')
    }


    // /**
    //  * 產生交易transaction狀態物件，當使用transaction時資料庫會上鎖，只能供調用的連線操作處理
    //  *
    //  * @memberOf WOrmMdb
    //  * @returns {Promise} 回傳Promise，resolve回傳交易transaction物件，reject回傳錯誤訊息
    //  */
    // async function genTransaction() {
    //     let t
    //     // if (sequelize !== null) {
    //     //     t = await sequelize.transaction() //使用Unmanaged transaction (then-callback)
    //     //     // t.afterCommit(() => {
    //     //     //     console.log('afterCommit')
    //     //     // })
    //     // }
    //     // else {
    //     //     return Promise.reject('invalid sequelize')
    //     // }
    //     return t
    // }


    function getUseFind(find) {

        function getKNew(k) {
            let kNew = null
            if (k === 'regex') {
                kNew = Op.substring
            }
            else if (k === 'options') {
                kNew = null
            }
            else if (k === 'nin') {
                kNew = Op.notIn
            }
            else {
                kNew = Op[k]
            }
            // if (k === 'regex') {
            //     kNew = 'substring' //Op.substring
            // }
            // else if (k === 'options') {
            //     kNew = null
            // }
            // else if (k === 'nin') {
            //     kNew = 'notIn' //Op.notIn
            // }
            // else {
            //     kNew = k //Op[k]
            // }
            // if (kNew !== null) {
            //     kNew = '$' + kNew
            // }
            return kNew
        }

        function cvObj(o) {
            let oNew = {}
            each(o, (v, k) => {
                let kNew = k
                if (k.indexOf('$') >= 0) {
                    k = k.replace('$', '')
                    kNew = getKNew(k) //只針對開頭為$的指令轉譯
                }
                let vNew = v
                if (isarr(v)) {
                    vNew = cvArray(v)
                }
                else if (isobj(v)) {
                    vNew = cvObj(v)
                }
                if (kNew !== null) {
                    oNew[kNew] = vNew
                }
            })
            return oNew
        }

        function cvArray(o) {
            let oNew = []
            each(o, (v) => {
                let vNew = v
                if (isarr(v)) {
                    vNew = cvArray(v)
                }
                else if (isobj(v)) {
                    vNew = cvObj(v)
                }
                oNew.push(vNew)
            })
            return oNew
        }

        function cvFind(o) {
            let oNew = cvObj(o)
            return oNew
        }

        //find
        if (!isobj(find)) {
            find = {}
        }
        find = cloneDeep(find)

        //useFind
        let useFind = cvFind(find)

        return useFind
    }


    async function findAll(si, find) {

        async function selectAll(si, find) {

            //useFind
            let useFind = getUseFind(find)

            //md
            let md = si.mds[opt.cl]

            //getSelect
            let cmd = await getSelect(opt.cl, md, useFind)

            //query
            let rs = await adodb.query(cmd)

            return rs
        }

        //data, 先查詢出access mdb內全部資料
        let data = await selectAll(si, {})

        //useFind
        let useFind = getUseFind(find)

        //query
        let rs = await queryMemory(opt, data, useFind)

        return rs
    }


    async function findOne(si, find) {
        let rs = await findAll(si, find)
        let r = get(rs, 0, null)
        return r
    }


    async function insertOne(si, data) {

        //md
        let md = si.mds[opt.cl]

        //getInsert
        let cmd = await getInsert(opt.cl, md, data)

        //execute
        await adodb.execute(cmd)

        return 'ok'
    }


    async function insertAll(si, data) {
        //node-adodb 5.0.3不支援transaction(舊版應該有支援), 查ADODB class內沒有transaction, 應該是還在修復中無法用, 故只能1次1組

        //pm
        let pm = genPm()

        //pmSeries
        let i = 0
        await pmSeries(data, async(v) => {

            //insertOne
            await insertOne(si, v)

            //count
            i++

        })
            .then(() => {
                pm.resolve('ok')
            })
            .catch((err) => {
                pm.reject({
                    err,
                    i,
                })
            })

        return pm
    }


    async function updateOne(si, data, find) {

        //useFind
        let useFind = getUseFind(find)

        //md
        let md = si.mds[opt.cl]

        //getUpdate
        let cmd = await getUpdate(opt.cl, md, data, useFind)

        //execute
        await adodb.execute(cmd)

        return 'ok'
    }


    async function destroyAll(si, find) {

        //useFind
        let useFind = getUseFind(find)

        //md
        let md = si.mds[opt.cl]

        //getUpdate
        let cmd = await getDelete(opt.cl, md, useFind)

        //execute
        await adodb.execute(cmd)

        return 'ok'
    }


    /**
     * 查詢數據
     *
     * @memberOf WOrmMdb
     * @param {Object} [find={}] 輸入查詢條件物件
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳數據，reject回傳錯誤訊息
     */
    async function select(find = {}, option = {}) {

        //instance
        let instance = get(option, 'instance', null)

        // //transaction
        // let transaction = get(option, 'transaction', null)

        //si
        let si = instance
        if (instance === null) {
            si = await initAdodb()
        }

        //rs
        let rs = null
        if (!si.err) {

            //findAll
            rs = await findAll(si, find)

        }
        else {
            ee.emit('error', si.err)
        }

        //closeSequelize
        if (instance === null) { //內部自動初始化得close
            await closeSequelize('select')
        }

        return rs
    }


    /**
     * 插入數據，插入同樣數據會自動產生不同_id，故insert前需自行判斷有無重複
     *
     * @memberOf WOrmMdb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳插入結果，reject回傳錯誤訊息
     */
    async function insert(data, option = {}) {

        //instance
        let instance = get(option, 'instance', null)

        // //transaction
        // let transaction = get(option, 'transaction', null)

        //cloneDeep
        data = cloneDeep(data)

        //pm
        let pm = genPm()

        //si
        let si = instance
        if (instance === null) {
            si = await initAdodb()
        }

        if (!si.err) {

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //n
            let n = size(data)

            //check
            if (opt.autoGenPK) {
                data = map(data, function(v) {
                    if (!v[opt.pk]) {
                        v[opt.pk] = genID()
                    }
                    return v
                })
            }

            //pmSeries
            await insertAll(si, data)
                .then(() => {
                    let res = { n, nInserted: n, ok: 1 }
                    pm.resolve(res)
                    ee.emit('change', 'insert', data, res)
                })
                .catch(({ err, i }) => {
                    ee.emit('error', err)
                    pm.reject({ n: i, ok: 0 })
                })

        }
        else {
            pm.reject(si.err)
        }

        //closeSequelize
        if (instance === null) { //內部自動初始化得close
            await closeSequelize('select')
        }

        return pm
    }


    /**
     * 儲存數據
     *
     * @memberOf WOrmMdb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @param {boolean} [option.autoInsert=true] 輸入是否於儲存時發現原本無數據，則自動改以插入處理，預設為true
     * @returns {Promise} 回傳Promise，resolve回傳儲存結果，reject回傳錯誤訊息
     */
    async function save(data, option = {}) {

        //cloneDeep
        data = cloneDeep(data)

        //instance
        let instance = get(option, 'instance', null)

        // //transaction
        // let transaction = get(option, 'transaction', null)

        //autoInsert
        let autoInsert = get(option, 'autoInsert', true)

        //pm
        let pm = genPm()

        //si
        let si = instance
        if (instance === null) {
            si = await initAdodb()
        }

        if (!si.err) {

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //check
            if (opt.autoGenPK) {
                data = map(data, function(v) {
                    if (!v[opt.pk]) {
                        v[opt.pk] = genID()
                    }
                    return v
                })
            }

            //pmSeries
            await pmSeries(data, async(v) => {
                let pmm = genPm()

                //err
                let err = null

                //r
                let r
                if (v[opt.pk]) {
                    //有id

                    //findOne
                    let find = { [opt.pk]: v[opt.pk] }
                    r = await findOne(si, find)
                        .catch((error) => {
                            ee.emit('error', error)
                            err = error
                        })

                }
                else {
                    //沒有id
                    err = `${opt.pk} is invalid`
                }

                if (r) {
                    //有找到資料

                    //updateOne
                    let find = { [opt.pk]: v[opt.pk] }
                    let rr = await updateOne(si, v, find)
                        .catch((error) => {
                            ee.emit('error', error)
                            err = error
                        })

                    if (rr) {
                        //console.log('update 有更新資料', rr)
                        pmm.resolve({ n: 1, nModified: 1, ok: 1 })
                    }
                    else {
                        //console.log('update 沒有更新資料', err)
                        pmm.resolve({ n: 1, nModified: 0, ok: 0 })
                    }

                }
                else {
                    //沒有找到資料

                    //autoInsert
                    if (autoInsert) {

                        //insertOne
                        let rr = await insertOne(si, v)
                            .catch((error) => {
                                ee.emit('error', error)
                                err = error
                            })

                        if (rr) {
                            //console.log('create 有插入資料', rr)
                            pmm.resolve({ n: 1, nInserted: 1, ok: 1 })
                        }
                        else {
                            //console.log('create 沒有插入資料', err)
                            pmm.resolve({ n: 1, nInserted: 0, ok: 0 })
                        }

                    }
                    else {
                        //console.log('findOne 沒有找到資料也不自動插入', err)
                        pmm.resolve({ n: 0, nModified: 0, ok: 1 })
                    }

                }

                pmm._err = err //避免eslint錯誤訊息
                return pmm
            })
                .then((res) => {
                    pm.resolve(res)
                    ee.emit('change', 'save', data, res)
                })
                .catch((error) => {
                    pm.reject(error)
                })

        }
        else {
            pm.reject(si.err)
        }

        //closeSequelize
        if (instance === null) { //內部自動初始化得close
            await closeSequelize('select')
        }

        return pm
    }


    /**
     * 刪除數據
     *
     * @memberOf WOrmMdb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳刪除結果，reject回傳錯誤訊息
     */
    async function del(data, option = {}) {

        //cloneDeep
        data = cloneDeep(data)

        //instance
        let instance = get(option, 'instance', null)

        // //transaction
        // let transaction = get(option, 'transaction', null)

        //pm
        let pm = genPm()

        //si
        let si = instance
        if (instance === null) {
            si = await initAdodb()
        }

        if (!si.err) {

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //pmSeries
            await pmSeries(data, async function(v) {
                let pmm = genPm()

                //err
                let err = null

                //r
                let r
                if (v[opt.pk]) {
                    //有id

                    //findOne
                    let find = { [opt.pk]: v[opt.pk] }
                    r = await findOne(si, find)
                        .catch((error) => {
                            ee.emit('error', error)
                            err = error
                        })

                }
                else {
                    //沒有id
                    err = `${opt.pk} is invalid`
                }

                if (r) {
                    //有找到資料

                    //destroyAll
                    let find = { [opt.pk]: v[opt.pk] }
                    let rr = await destroyAll(si, find)
                        .catch((error) => {
                            ee.emit('error', error)
                            err = error
                        })

                    if (rr) {
                        //console.log('destroy 有刪除資料', rr)
                        pmm.resolve({ n: 1, nDeleted: 1, ok: 1 })
                    }
                    else {
                        //console.log('destroy 沒有刪除資料', err)
                        pmm.resolve({ n: 1, nDeleted: 0, ok: 0 })
                    }

                }
                else {
                    //console.log('findOne 沒有找到資料', err)
                    pmm.resolve({ n: 0, nDeleted: 0, ok: 1 })
                }

                pmm._err = err //避免eslint錯誤訊息
                return pmm
            })
                .then((res) => {
                    pm.resolve(res)
                    ee.emit('change', 'del', data, res)
                })
                .catch((res) => {
                    pm.reject(res)
                })

        }
        else {
            pm.reject(si.err)
        }

        return pm
    }


    /**
     * 刪除全部數據，需與del分開，避免未傳數據導致直接刪除全表
     *
     * @memberOf WOrmMdb
     * @param {Object} [find={}] 輸入刪除條件物件
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {Object} [option.instance=null] 輸入實例instance物件，預設為null
     * @param {Object} [option.transaction=null] 輸入交易(transaction)物件，預設為null
     * @returns {Promise} 回傳Promise，resolve回傳刪除結果，reject回傳錯誤訊息
     */
    async function delAll(find = {}, option = {}) {

        //find
        if (!isobj(find)) {
            find = {}
        }
        find = cloneDeep(find)

        //instance
        let instance = get(option, 'instance', null)

        // //transaction
        // let transaction = get(option, 'transaction', null)

        //pm
        let pm = genPm()

        //si
        let si = instance
        if (instance === null) {
            si = await initAdodb()
        }

        if (!si.err) {

            //findAll, 因access mdb沒辦法回傳刪除的列數量, 只好多耗功先查詢一次再刪
            let rs = await findAll(si, find)

            //n
            let n = size(rs)

            //destroyAll
            await destroyAll(si, find)
                .then((res) => {
                    res = { n, nDeleted: n, ok: 1 }
                    pm.resolve(res)
                    ee.emit('change', 'delAll', null, res)
                })
                .catch((error) => {
                    ee.emit('error', error)
                    pm.reject({ n: 0, ok: 0 })
                })

        }
        else {
            pm.reject(si.err)
        }

        //closeSequelize
        if (instance === null) { //內部自動初始化得close
            await closeSequelize('select')
        }

        return pm
    }


    /**
     * 創建mdb資料庫檔案
     *
     * @memberOf WOrmMdb
     * @returns {Promise} 回傳Promise，resolve回傳創建結果，reject回傳錯誤訊息
     */
    async function createStorage() {
        console.log('還不能createStorage產生mdb檔')

        //pm
        let pm = genPm()

        // //initAdodb
        // let si = await initAdodb()

        // //closeSequelize
        // await closeSequelize('createStorage')

        // //check
        // if (si.err) {
        //     pm.reject(si.err)
        // }
        // else {
        //     pm.resolve('created')
        // }

        return pm
    }


    // /**
    //  * 由指定資料庫生成各資料表的models資料
    //  *
    //  * 目前僅能產生js檔格式，且mdb欄位為nvarchar(MAX)無法自動轉成TEXT格式
    //  *
    //  * include from: [w-auto-sequelize](https://github.com/yuda-lyu/w-auto-sequelize)
    //  *
    //  * @memberOf WOrmMdb
    //  * @param {Object} [option={}] 輸入設定物件，預設{}
    //  * @param {String} [option.storage='./worm.db'] 輸入mdb資料庫檔案位置字串，預設'./worm.db'
    //  * @param {String} [option.db='worm'] 輸入資料庫名稱字串，預設'worm'
    //  * @param {String} [option.username='username'] 輸入使用者名稱字串，預設'username'
    //  * @param {String} [option.password='password'] 輸入密碼字串，預設'password'
    //  * @param {String} [option.fdModels='./models'] 輸入models儲存的資料夾名稱字串，預設'./models'
    //  * @param {String} [option.host='localhost'] 輸入連線主機host位址字串，預設'localhost'
    //  * @param {Integer} [option.port=1433] 輸入連線主機port整數，預設1433
    //  * @returns {Promise} 回傳Promise，resolve回傳產生的models資料，reject回傳錯誤訊息
    //  */
    // function genModelsByDB(option = {}) {

    //     //default
    //     let def = {
    //         username: 'username',
    //         password: 'password',
    //         storage: './worm.mdb',
    //     }

    //     //merge
    //     option = {
    //         ...def,
    //         ...option,
    //     }

    //     //database
    //     if (!option.db) {
    //         option.db = 'worm'
    //     }
    //     option.database = opt.db

    //     //directory
    //     if (!option.fdModels) {
    //         option.fdModels = './models'
    //     }
    //     option.directory = opt.fdModels

    //     //storage
    //     option.storage = path.resolve(option.storage)

    //     //WAutoSequelize
    //     return WAutoSequelize(option)

    // }


    /**
     * 由資料表物件生成各資料表的models資料
     *
     * @memberOf WOrmMdb
     * @param {String} [fd='./models'] 輸入models儲存的資料夾名稱字串，預設'./models'
     * @param {Object} [tabs={}] 輸入各資料表物件，預設{}
     * @param {Object} [opt={}] 輸入設定物件，預設{}
     * @param {String} [opt.type='js'] 輸入資料表類型字串，預設'js'
     */
    function genModelsByTabs(...input) {
        _genModelsByTabs(...input)
    }


    //bind
    ee.createStorage = createStorage
    // ee.genModelsByDB = genModelsByDB
    ee.genModelsByTabs = genModelsByTabs
    ee.init = initAdodb
    // ee.genTransaction = genTransaction
    if (opt.useStable) {
        //用佇列(同時最大執行數1且先進先執行)處理高併發之情形
        //若沒管控:
        //access mdb有機會出錯[Error: ConnectionManager.getConnection was called after the connection manager was closed!]
        ee.select = function() {
            return pmq(select, ...arguments)
        }
        ee.insert = function() {
            return pmq(insert, ...arguments)
        }
        ee.save = function() {
            return pmq(save, ...arguments)
        }
        ee.del = function() {
            return pmq(del, ...arguments)
        }
        ee.delAll = function() {
            return pmq(delAll, ...arguments)
        }
    }
    else {
        ee.select = select
        ee.insert = insert
        ee.save = save
        ee.del = del
        ee.delAll = delAll
    }

    return ee
}


export default WOrmMdb
