import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'


//測試共用: 令ensureBins取得之connMDB.exe來自repo之bin/(須與bin/manifest.json一致), 且測試絕不連網
//作法: 載入本檔時將bin/之執行檔依清單之sha256播種到預設快取<套件根>/bin-cache/<sha256>/<name>(已存在且內容相同則略過, 暫存檔加原子更名故可並行), 並設W_BIN_OFFLINE=1
//註: 播種的是bin/之實檔而非清單值, 兩者不一致(忘了重產清單)時ensureBins校驗不符, 離線下以E_OFFLINE_MISSING明確失敗, 不會悄悄用到不符的執行檔
//註: 子行程繼承環境變數故同樣離線; 以子行程驗證環境變數或鏡像者(unit-ensurebins)於spawn時自行覆寫env


let fdRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')


function seedBins() {
    let manifest = JSON.parse(fs.readFileSync(path.join(fdRoot, 'bin/manifest.json'), 'utf8'))
    for (let f of manifest.files) {
        let fpSrc = path.join(fdRoot, f.path)
        let fdDst = path.join(fdRoot, 'bin-cache', f.sha256)
        let fpDst = path.join(fdDst, f.name)
        let ok = false
        try {
            //執行檔僅約12KB, 逐位元組比對; 同大小但內容不同者(殘留的竄改檔)視為未播種
            ok = fs.readFileSync(fpDst).equals(fs.readFileSync(fpSrc))
        }
        catch (err) {}
        if (!ok) {
            fs.mkdirSync(fdDst, { recursive: true })
            let fpTmp = `${fpDst}.seed-${process.pid}`
            fs.copyFileSync(fpSrc, fpTmp)
            try {
                fs.renameSync(fpTmp, fpDst)
            }
            catch (err) {
                //並行的另一行程已先放好(Windows下更名到使用中之檔會失敗), 刪自己的暫存檔即可
                fs.rmSync(fpTmp, { force: true })
            }
        }
    }
}


//Jet僅Windows可用, 其他平台(CI)之測試皆跳過, 不必播種
if (process.platform === 'win32') {
    seedBins()
    process.env.W_BIN_OFFLINE = '1'
}


export { fdRoot, seedBins }
