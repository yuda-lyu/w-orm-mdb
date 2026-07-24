import Sequelize from 'sequelize'
import cloneDeep from 'lodash-es/cloneDeep.js'
import isarr from 'wsemi/src/isarr.mjs'
import pm2resolve from 'wsemi/src/pm2resolve.mjs'
import importModels from 'w-orm-reladb/src/importModels.mjs'


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

    //importModels, 若model內id不是pk則需要強制更改成為pk, 否則sequelize無法匯入
    let sync = true //需設定sync同步, 否則使用[sqlite::memory:]於importModels後, 無法執行指令如findAll
    let r = await pm2resolve(importModels)(opt.fdModels, sequelize, opt.cl, { sync, type: opt.modelType })

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


async function queryMemory(opt, data, useFind) {

    //check
    if (!isarr(data)) {
        return Promise.reject('data is not an array')
    }

    //initSequelize
    let r = await initSequelize(opt)

    //sequelize
    let sequelize = r.sequelize

    //md
    let md = r.mds[opt.cl]

    //bulkCreate
    await md.bulkCreate(data)

    //setting
    let setting = {
        where: useFind,
        raw: true,
    }

    //findAll
    let rs = await md.findAll(setting)

    //cloneDeep
    rs = cloneDeep(rs)

    //close
    if (sequelize !== null) {
        await sequelize.close()
    }

    return rs
}

export { initSequelize, queryMemory }
