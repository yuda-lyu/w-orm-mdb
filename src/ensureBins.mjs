import path from 'path'
import { fileURLToPath } from 'url'
import fsEnsureBins from 'wsemi/src/fsEnsureBins.mjs'


//pkgRoot, 本套件根目錄(以本檔位置推得, 不依賴工作目錄; 原始碼為<套件根>/src/, 打包後為<套件根>/dist/, 皆為其上一層)
let pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')


/**
 * 取得本套件之外部執行檔connMDB.exe: 首次使用時下載(或自鏡像取得)並以bin/manifest.json之SHA-256與大小校驗, 之後自快取取得(亦校驗)
 *
 * 規格: 外部執行檔之存放下載校驗與離線(制式規格)§6; 實作為wsemi之fsEnsureBins, 本套件不另寫下載、快取、鏡像、校驗
 * 環境變數: W_BIN_CACHE(共用快取資料夾)、W_BIN_MIRROR(鏡像, 本地資料夾或http(s)網址)、W_BIN_OFFLINE(1為離線), 見README〈External executable〉
 *
 * @param {Object} [opt={}] 輸入設定物件, 交wsemi之fsEnsureBins(names、cacheDir、mirror、offline、onProgress等), pkgRoot固定為本套件根
 * @returns {Promise} 回傳Promise, resolve回傳{ [檔名]: 絕對路徑 }, reject回傳帶code之Error(E_OFFLINE_MISSING等)
 */
function ensureBins(opt = {}) {
    //floatingManifestUrl會改變清單之信任錨, 不轉傳使用者之值(主幹模式之網址由清單之repo與manifestPath決定)
    let { floatingManifestUrl, ...o } = opt || {} // eslint-disable-line no-unused-vars
    return fsEnsureBins('bin/manifest.json', { ...o, pkgRoot })
}


export default ensureBins
