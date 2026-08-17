import fs from 'fs'


//各unit測試檔之共用層
//註: 本檔不含測試案例, mocha(無設定檔, 預設納入test/*.mjs)載入本檔亦無副作用


/**
 * 是否為Windows
 *
 * 註: 本套件經Windows內建之Jet 4.0引擎操作mdb, 非Windows無從執行, 故各測試檔以此跳過
 */
function isWindows() {
    return process.platform === 'win32'
}


/**
 * 建立本測試檔專屬之暫存資料夾與mdb副本
 *
 * 註: 各測試檔須用各自的資料夾, 才可於--parallel下各自建立與移除而互不干擾
 * 註: 資產由node toolg/genTestMdbAssets.mjs產生, 表結構為
 *     [users]: id TEXT(255) PK, name TEXT(255), value DOUBLE
 */
function setupStorage(nm, opt = {}) {

    //useEncryption
    let useEncryption = opt.useEncryption === true

    //fdTmp, fpStorage
    let fdTmp = `./test/temp-${nm}`
    let fpStorage = `${fdTmp}/${nm}.mdb`

    //先清殘留再建
    fs.rmSync(fdTmp, { recursive: true, force: true })
    fs.mkdirSync(fdTmp, { recursive: true })

    //copy
    let fpAsset = useEncryption
        ? './test/assets/worm_encryption_def.mdb'
        : './test/assets/worm_def.mdb'
    fs.copyFileSync(fpAsset, fpStorage)

    return {
        fdTmp,
        fpStorage,
    }
}


/**
 * 移除本測試檔專屬之暫存資料夾
 */
function cleanStorage(fdTmp) {
    try {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    }
    catch (err) {}
}


/**
 * 產生建構設定物件
 */
function mkOpt(fpStorage, ext = {}) {
    return {
        url: 'mdb://:',
        db: 'worm',
        cl: 'users',
        fdModels: './models',
        storage: fpStorage,
        ...ext,
    }
}


/**
 * 取Promise之結果別, 供斷言resolve或reject而不倚賴錯誤訊息文字
 */
async function getRt(pm) {
    return pm
        .then(() => {
            return 'resolve'
        })
        .catch(() => {
            return 'reject'
        })
}


export { isWindows, setupStorage, cleanStorage, mkOpt, getRt }
