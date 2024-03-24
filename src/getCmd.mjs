import isNumber from 'lodash-es/isNumber.js'
import each from 'lodash-es/each.js'
import genPm from 'wsemi/src/genPm.mjs'
import replace from 'wsemi/src/replace.mjs'
import treeObj from 'wsemi/src/treeObj.mjs'
import strright from 'wsemi/src/strright.mjs'
import strdelleft from 'wsemi/src/strdelleft.mjs'
import strdelright from 'wsemi/src/strdelright.mjs'
import isstr from 'wsemi/src/isstr.mjs'
import cstr from 'wsemi/src/cstr.mjs'


function clearCmd(tableName, cmd) {
    cmd = strdelleft(cmd, 21) //刪除[Executing (default): ]
    //cmd = replace(cmd, '`' + tableName + '`.', '') //刪除where會針對欄位添加{tableName}.
    if (strright(cmd, 1) === ';') {
        cmd = strdelright(cmd, 1) //刪除最後分號
    }
    return cmd
}


function assignCmd(params, cmd) {
    each(params, (v, k) => {
        let i = k + 1
        let c = v
        if (isstr(c)) {
            c = `'${c}'`
        }
        else {
            c = cstr(c)
        }
        cmd = replace(cmd, `\\$${i}`, c)
    })
    return cmd
}


async function getSelect(tableName, tableModel, useFind) {
    //若find使用查找數字或大小於時, 所產生的cmd會把值改為字串, 例如[SELECT `id`, `name`, `value` FROM `users` AS `users` WHERE `users`.`value` = '123']
    //此在MSSql是沒問題, 但Access會回報準則運算式的資料類型不符合
    //故得通過先找到可能查詢用value為數字者, 先紀錄至清單checkList, 呼叫resetTypeCmd把cmd逐一取代回來

    //checkList
    let checkList = {}
    // console.log('useFind', useFind)
    treeObj(useFind, (value, key, nk) => {
        // console.log('value', value, 'key', key, 'nk', nk)
        if (isNumber(value)) {
            checkList[`'${value}'`] = value
        }
        return value
    }, { force: true })
    // console.log('checkList', checkList)

    //resetTypeCmd
    function resetTypeCmd(cmd) {
        each(checkList, (v, k) => {
            cmd = replace(cmd, `${k}`, cstr(v))
        })
        return cmd
    }

    //pm
    let pm = genPm()

    //setting
    let setting = {
        logging: (sql, queryObject) => {
            // console.log('sql:', sql)
            // console.log('queryObject:', queryObject)

            //cmd
            let cmd = clearCmd(tableName, sql)

            //resetTypeCmd
            cmd = resetTypeCmd(cmd)

            //resolve
            pm.resolve(cmd)

        },
        where: useFind,
        raw: true,
    }

    //get sql from logging
    await tableModel.findAll(setting)

    return pm
}


async function getInsert(tableName, tableModel, data) {
    //node-adodb內因為是操作Access, 故核心就不支援VALUES做插入多組數據, 所以變成需一次處理1組data, Access不支援[INSERT INTO users(`id`, `name`, `value`) VALUES ("a9", "b", 123.321),("a10", "b", 123.321);]

    // //Access可插入多列方式, virtable為虛擬表, 得先於mdb新建, 且至少要有1列以上數據存在才能用此法
    // let t=`
    // INSERT INTO users
    // SELECT *
    // FROM (
    //     SELECT 'z7' as id, 'z name' as name,12.3 as [value] FROM virtable
    //     UNION
    //     SELECT 'z8' as id, 'z name' as name,12.3 as [value] FROM virtable
    // )
    // `

    //pm
    let pm = genPm()

    //setting
    let setting = {
        logging: (sql, queryObject) => {
            // console.log('sql:', sql)
            // console.log('queryObject:', queryObject)

            //cmd
            let cmd = clearCmd(tableName, sql)

            //assignCmd
            cmd = assignCmd(queryObject.bind, cmd)

            //resolve
            pm.resolve(cmd)

        },
    }

    //get sql from logging
    await tableModel.create(data, setting)
    // await tableModel.bulkCreate([data], setting)

    return pm
}


async function getUpdate(tableName, tableModel, data, useFind) {

    //pm
    let pm = genPm()

    //setting
    let setting = {
        logging: (sql, queryObject) => {
            // console.log('sql:', sql)
            // console.log('queryObject:', queryObject)

            //cmd
            let cmd = clearCmd(tableName, sql)

            //assignCmd
            cmd = assignCmd(queryObject.bind, cmd)

            //resolve
            pm.resolve(cmd)

        },
        where: useFind,
    }

    //get sql from logging
    await tableModel.update(data, setting)
    //await tableModel.bulkUpdate([data], setting)

    return pm
}


async function getDelete(tableName, tableModel, useFind) {

    //pm
    let pm = genPm()

    //setting
    let setting = {
        logging: (sql, queryObject) => {
            // console.log('sql:', sql)
            // console.log('queryObject:', queryObject)

            //cmd
            let cmd = clearCmd(tableName, sql)

            // //assignCmd
            // cmd = assignCmd(queryObject.bind, cmd)

            //resolve
            pm.resolve(cmd)

        },
        where: useFind,
    }

    //get sql from logging
    await tableModel.destroy(setting)

    return pm
}


export { getSelect, getInsert, getUpdate, getDelete }


