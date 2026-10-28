import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'


//測試對象之src資料夾: 預設為本專案之src; 環境變數WORM_SRC_DIR(絕對路徑)可指向修改前(git archive HEAD)或變異副本之src,
//供診斷輸出測試(R-DIAG)之[修前紅]與變異驗證使用(同一份測試對不同版本之src執行); 子行程(urlerrWorker)繼承環境變數故同樣生效
//註: connMDB.exe由jet.mjs依cwd之./src/或node_modules/w-orm-mdb/src/尋找, 不受本設定影響


function getSrcDir() {
    let d = process.env.WORM_SRC_DIR
    if (typeof d === 'string' && d !== '') {
        return path.resolve(d)
    }
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')
}


async function importSrc(name) {
    return import(pathToFileURL(path.join(getSrcDir(), name)).href)
}


export { getSrcDir, importSrc }
